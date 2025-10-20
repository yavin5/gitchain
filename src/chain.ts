import { ADMIN_ADDRESS } from './admin-address.js';

// Declare CryptoJS for TypeScript (loaded via CDN at runtime)
declare const CryptoJS: {
    SHA256: (value: string) => { toString: () => string };
};
// Declare elliptic for secp256k1 (loaded via CDN)
declare const ec: any;
// Declare js-sha3 for keccak256 (loaded via CDN)
declare const sha3: {
    keccak256: (data: string) => string;
};
// Declare window.gitchain for TypeScript
interface Gitchain {
    saveGithubAccessToken: () => void;
    viewChain: () => Promise<void>;
    processTxns: () => Promise<void>;
    fetchState: () => Promise<{ content: State; sha: string } | null>;
    connectAndSendTx: (tx: Transaction) => Promise<void>;
}
declare global {
    interface Window {
        gitchain: Gitchain;
    }
}

import { createLibp2p } from 'libp2p';
import { webRTC } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { circuitRelayTransport, CircuitRelayTransportInit } from '@libp2p/circuit-relay-v2';
import { bootstrap } from '@libp2p/bootstrap';
import { gossipsub } from '@libp2p/gossipsub';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { multiaddr } from '@multiformats/multiaddr';
import { fromString as uint8FromString, toString as uint8ToString, concat as uint8Concat } from 'uint8arrays';

// Dynamic OWNER and REPO from URL
const hostnameParts = location.hostname.split('.');
const OWNER: string = hostnameParts[0];
const REPO: string = location.pathname === '/' || location.pathname === '' ? `${OWNER}.github.io` : location.pathname.split('/')[1];
const FQ_REPO: string = `${OWNER}/${REPO}`;
const SERVER_PEER_PATH: string = 'data/server-peer.json';
const SERVER_PEER_URL: string = `https://api.github.com/repos/${FQ_REPO}/contents/${SERVER_PEER_PATH}`;
const SERVER_PEER_RAW_URL: string = `https://raw.githubusercontent.com/${FQ_REPO}/main/${SERVER_PEER_PATH}`;
const STATE_PATH: string = 'data/state.json';
const STATE_URL: string = `https://api.github.com/repos/${FQ_REPO}/contents/${STATE_PATH}`;
const GITHUB_ACCESS_TOKEN_KEY: string = 'gitchain_github_access_token';
const ISSUES_URL: string = `https://api.github.com/repos/${FQ_REPO}/issues`;
// Constants for P2P
const PROTOCOL = '/gitchain/tx/1.0.0';
const UPDATE_INTERVAL = 2 * 60 * 1000; // 2 minutes
// Global P2P state
let libp2p: any = null;
let isServer = false;
let serverPeers: string[] = [];
// Interfaces
interface Transaction {
    from: string;
    to: string;
    amount: number;
    nonce: number;
    signature: string;
}
interface Block {
    index: number;
    previousHash: string;
    timestamp: string;
    transactions: Transaction[];
    hash: string;
}
interface State {
    chain: Block[];
    pending: Transaction[];
    balances: { [address: string]: number };
    nonces: { [address: string]: number };
    lastProcessedDate: string;
}
// Calculate hash
function calculateHash(index: number, previousHash: string, timestamp: string, transactions: Transaction[]): string {
    const value = `${index}${previousHash}${timestamp}${JSON.stringify(transactions)}`;
    return CryptoJS.SHA256(value).toString();
}
// Create genesis block
function createOriginalBlock(): Block {
    const timestamp = new Date().toISOString();
    return {
        index: 0,
        previousHash: '0',
        timestamp,
        transactions: [],
        hash: calculateHash(0, '0', timestamp, [])
    };
}
// Serialize txn for signing/hash
function serializeTxn(txn: Omit<Transaction, 'signature'>): string {
    return JSON.stringify(txn, Object.keys(txn).sort());
}
// Keccak256 using js-sha3
function keccak256(data: string): Uint8Array {
    const hex = sha3.keccak256(data);
    const matches = hex.match(/.{2}/g);
    if (!matches) {
        throw new Error('Failed to parse hex string');
    }
    return new Uint8Array(matches.map((byte: string) => parseInt(byte, 16)));
}
// Hex to bytes
function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}
// Bytes to hex
function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
// Verify signature using elliptic
function verifyTxn(txn: Transaction): boolean {
    try {
        const msgHash = keccak256(serializeTxn({ from: txn.from, to: txn.to, amount: txn.amount, nonce: txn.nonce }));
        const sigBytes = hexToBytes(txn.signature);
        if (sigBytes.length !== 65) return false;
        const r = bytesToHex(sigBytes.slice(0, 32));
        const s = bytesToHex(sigBytes.slice(32, 64));
        const v = sigBytes[64] - 27; // Normalize v to 0 or 1
        const curve = new ec('secp256k1');
        const msgHashHex = bytesToHex(msgHash);
        const signature = { r: r, s: s };
        const publicKey = curve.recoverPubKey(msgHashHex, signature, v);
        const addrHash = keccak256(publicKey.encode('array', true).slice(1)); // Compressed public key without 0x04
        const recoveredAddr = `0x${bytesToHex(addrHash.slice(-20))}`;
        return recoveredAddr.toLowerCase() === txn.from.toLowerCase();
    } catch {
        return false;
    }
}
// Process a single txn (mint if from admin)
async function processTxn(txn: Transaction, state: State): Promise<{ valid: boolean; txid: string }> {
    const txid = bytesToHex(keccak256(serializeTxn({ from: txn.from, to: txn.to, amount: txn.amount, nonce: txn.nonce })));
    if (!verifyTxn(txn)) return { valid: false, txid };
    if ((state.nonces[txn.from] || 0) + 1 !== txn.nonce) return { valid: false, txid };
    if (txn.from.toLowerCase() !== ADMIN_ADDRESS.toLowerCase() && (state.balances[txn.from] || 0) < txn.amount) return { valid: false, txid };
    if (!/^0x[a-fA-F0-9]{40}$/.test(txn.from) || !/^0x[a-fA-F0-9]{40}$/.test(txn.to)) return { valid: false, txid };
    state.pending.push(txn);
    return { valid: true, txid };
}
// Create block
async function createBlock(state: State): Promise<number | null> {
    if (state.pending.length === 0) return null;
    const validTxns: Transaction[] = [];
    const newBalances = { ...state.balances };
    const newNonces = { ...state.nonces };
    for (const txn of state.pending) {
        if (verifyTxn(txn) && (newNonces[txn.from] || 0) + 1 === txn.nonce && (txn.from.toLowerCase() === ADMIN_ADDRESS.toLowerCase() || (newBalances[txn.from] || 0) >= txn.amount)) {
            if (txn.from.toLowerCase() !== ADMIN_ADDRESS.toLowerCase()) {
                newBalances[txn.from] = (newBalances[txn.from] || 0) - txn.amount;
            }
            newBalances[txn.to] = (newBalances[txn.to] || 0) + txn.amount;
            newNonces[txn.from] = txn.nonce;
            validTxns.push(txn);
        }
    }
    if (validTxns.length === 0) {
        state.pending = [];
        return null;
    }
    const nextIndex = state.chain.length;
    const previousHash = state.chain.length > 0 ? state.chain[state.chain.length - 1].hash : '0';
    const timestamp = new Date().toISOString();
    const hash = calculateHash(nextIndex, previousHash, timestamp, validTxns);
    const newBlock: Block = { index: nextIndex, previousHash, timestamp, transactions: validTxns, hash };
    state.chain.push(newBlock);
    state.pending = [];
    state.balances = newBalances;
    state.nonces = newNonces;
    return nextIndex;
}
// Get GitHub access token
function getGithubAccessToken(): string | null {
    let githubAccessToken = localStorage.getItem(GITHUB_ACCESS_TOKEN_KEY);
    if (!githubAccessToken) {
        githubAccessToken = (document.getElementById('github-token') as HTMLInputElement)?.value;
        if (!githubAccessToken) {
            console.log('No GitHub access token provided');
            alert('Please enter your GitHub access token.');
            return null;
        }
        localStorage.setItem(GITHUB_ACCESS_TOKEN_KEY, githubAccessToken);
    }
    console.log('Retrieved GitHub access token');
    return githubAccessToken;
}
// Initialize libp2p / WebRTC server
export async function initP2P(host: boolean): Promise<void> {
    console.log('Entering initP2P, host:', host);
    isServer = host;
    if (libp2p) {
        console.log('libp2p already initialized, reusing instance');
        return;
    }
    let bootstrapList: string[] = [];
    serverPeers = [];

    // First, enable debug logging!
    localStorage.setItem('debug', 'libp2p:*');

    try {
        const response = await fetch(SERVER_PEER_RAW_URL);
        if (response.ok) {
            serverPeers = await response.json();
            bootstrapList = serverPeers.filter(peer => peer !== '').map(peer => `/webrtc/p2p/${peer}`);
            console.log('Loaded server peers:', serverPeers);
        } else if (response.status === 404) {
            console.log('server-peer.json not found');
        } else {
            console.log('Error fetching server-peer.json, status:', response.status);
        }
    } catch (error) {
        console.error('Error loading server-peer.json:', error);
    }
    try {
        // Create libp2p configuration.
        const config: any = {
	    addresses: { listen: ['/webrtc'] },
            transports: [
	        webRTC({
                    rtcConfiguration: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:global.stun.twilio.com:3478' },
                            { urls: 'stun:stun.nextcloud.com:3478' },
                            { urls: 'stun:stun.1und1.de:3478' },
                            { urls: 'stun:stun.stunprotocol.org:3478' },
                            { urls: 'stun:stun.services.mozilla.com:3478' },
                            { urls: 'stun:stun.ekiga.net:3478' },
                            { urls: 'stun:stun.voipbuster.com:3478' }
                        ]
                    }
                }),
                webSockets(),
	        circuitRelayTransport({ discoverRelays: 1 } as CircuitRelayTransportInit)
            ],
            connectionEncryption: [noise()],
            streamMuxers: [yamux()],
            services: {
                identify: identify(),
                pubsub: gossipsub({ emitSelf: true }) // Allow local message handling
            },
            peerDiscovery: [
                pubsubPeerDiscovery({ interval: 20000 })
            ]
        };
        if (bootstrapList.length > 0) {
            config.peerDiscovery.push(bootstrap({ list: bootstrapList }));
        } else {
            console.log('No valid peers in bootstrapList, initializing without bootstrap');
        }
        libp2p = await createLibp2p(config);
        console.log('P2P node started:', libp2p.peerId.toString());
        libp2p.addEventListener('peer:discovery', (evt: any) => {
            console.log('Peer discovered:', evt.detail.id.toString());
        });
        libp2p.services.pubsub.addEventListener('subscription-change', (evt: any) => {
            console.log('Subscription change:', evt.detail);
        });
        await libp2p.handle(PROTOCOL, async ({ stream, connection }: any) => {
            console.log('Received P2P stream from:', connection.remotePeer.toString());
            const chunks: Uint8Array[] = [];
            for await (const chunk of stream.source) {
                chunks.push(chunk);
            }
            const data = uint8Concat(chunks);
            const txn = JSON.parse(uint8ToString(data));
            console.log('Received transaction via P2P:', txn);
        });
        if (isServer) {
            const peerId = libp2p.peerId.toString();
            if (!serverPeers.includes(peerId)) {
                serverPeers.push(multiaddr(`/webrtc/p2p/${peerId}`).toString());
                await updateServerPeers();
            }
            console.log('Server peer ID added to server-peer.json if not already present');
        }

        // Now dial every server peer to see which ones we can connect to.
        for (const peer of serverPeers) {
            try {
                const ma = multiaddr(peer);
                await libp2p.dial(ma, { signal: AbortSignal.timeout(60000) });
            } catch(error) {
                console.error(`Failed to dial ${peer}: ${error}`);
            }
        }
    } catch (error) {
        console.error('Failed to initialize P2P:', error);
        throw error; // Propagate error for debugging
    }
}
// Update server-peer.json
async function updateServerPeers(): Promise<boolean> {
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) {
        console.error('No PAT available for updating server-peer.json');
        return false;
    }
    try {
        const response = await fetch(SERVER_PEER_URL + '?ref=main', {
            headers: {
                'Authorization': `token ${githubAccessToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        let sha: string | null = null;
	    let data: any;
        if (response.ok) {
            data = await response.json();
            sha = data.sha;
        }
        console.log("data content: " + data.content);
        if ((data.content)) {
            data = atob(data.content);
            console.log('base64 decoded: ' + data);
            data = JSON.parse(data);
        }
        if (Array.isArray(data)) {
            for (const serverPeer in serverPeers) {
                if (!serverPeer.startsWith('/webrtc/')) continue;
                if (!data.includes(serverPeer)) {
                    console.log('Adding server peer: ' + serverPeer);
                    data.push(serverPeer);
                } else {
                    console.log("Not adding dupe server peer: " + serverPeer);
                }
            }
            console.log('Added serverPeers to data array.');
        } else {
            console.log('typeof data: ' + typeof data);
            data = serverPeers;
            console.log('data = serverPeers: ' + JSON.stringify(serverPeers));
        }
        const body = {
            message: 'Update server peer IDs',
            content: btoa(JSON.stringify(data, null, 2)),
            branch: 'main',
            sha: sha || undefined
        };
        const updateResponse = await fetch(SERVER_PEER_URL + '?ref=main', {
            method: 'PUT',
            headers: {
                'Authorization': `token ${githubAccessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (updateResponse.ok) {
            console.log('server-peer.json updated successfully');
            return true;
        } else {
            console.error('Failed to update server-peer.json:', await updateResponse.text());
            return false;
        }
    } catch (error) {
        console.error('Error updating server-peer.json:', error);
        return false;
    }
}
// Remove host peer ID on unload
async function removeHostPeerId(): Promise<void> {
    if (!isServer || !libp2p) return;
    const peerId = libp2p.peerId.toString();
    serverPeers = serverPeers.filter(id => id !== peerId);
    await updateServerPeers();
}
// Client-side: Connect and Send TX
export async function connectAndSendTx(tx: Transaction) {
    if (isServer) {
        const issueBody = JSON.stringify({
            type: 'gitchain_txn',
            repo: FQ_REPO,
            txn: tx
        });
        const response = await fetch(ISSUES_URL, {
            method: 'POST',
            headers: {
                'Authorization': `token ${getGithubAccessToken()}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: `tx ${tx.from} to ${tx.to}`,
                body: issueBody
            })
        });
        if (response.ok) {
            console.log('Host created issue for TX');
        } else {
            console.error('Host failed to create issue:', response.status, await response.text());
        }
        return;
    }
    let peers: string[] = [];
    try {
        const res = await fetch(SERVER_PEER_RAW_URL);
        if (res.ok) {
            peers = await res.json();
            console.log('Loaded active server peers:', peers);
        } else if (res.status === 404) {
            alert('The server is currently not running.');
            return;
        } else {
            alert('Failed to fetch server peer info. Please try again or notify the administrator.');
            return;
        }
    } catch (error) {
        console.error('Failed to fetch server-peer.json:', error);
        alert('Failed to connect to server. Please try again or notify the server administrator.');
        return;
    }
    if (peers.length === 0) {
        alert('The server is currently not running.');
        return;
    }
    let connected = false;
    for (const peer of peers) {
        try {
            const ma = multiaddr(peer);
            const connection = await libp2p.dial(ma, { signal: AbortSignal.timeout(60000) });
            const stream = await connection.newStream(PROTOCOL);
            const txJson = JSON.stringify(tx);
            const data = uint8FromString(txJson);
            await stream.sink([data]);
            console.log('TX sent to server peer:', peer);
            connected = true;
            break;
        } catch (error) {
            console.error('Failed to dial server peer:', peer, error);
        }
    }
    if (!connected) {
        alert('Failed to connect to any server. Please try again or notify the server administrator.');
    }
}
// Save GitHub access token
export function saveGithubAccessToken(): void {
    console.log('Entering saveGithubAccessToken');
    const githubAccessToken = (document.getElementById('github-token') as HTMLInputElement)?.value;
    if (githubAccessToken) {
        localStorage.setItem(GITHUB_ACCESS_TOKEN_KEY, githubAccessToken);
        console.log('PAT saved, initializing P2P as host');
    } else {
        console.error('No GitHub access token provided');
        throw new Error('Enter a GitHub access token first.');
    }
}
// Fetch state
export async function fetchState(): Promise<{ content: State; sha: string } | null> {
    console.log('Entering fetchState');
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) {
        console.log('No PAT available for fetching state');
        return null;
    }
    try {
        console.log('Fetching state from:', STATE_URL);
        const response = await fetch(`${STATE_URL}?ref=main`, {
            headers: {
                'Authorization': `token ${githubAccessToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (!response.ok) {
            if (response.status === 404) {
                console.log('State file not found');
                return null;
            }
            console.error('Error fetching state:', response.status, await response.text());
            throw new Error(`Error fetching state: ${response.statusText}`);
        }
        const file = await response.json();
        const content: State = JSON.parse(atob(file.content));
        console.log('State fetched, chain length:', content.chain.length);
        return { content, sha: file.sha };
    } catch (error) {
        console.error('Error fetching state:', error);
        return null;
    }
}
// Update state with retries
async function updateState(newContent: State, oldSha: string | null, message: string, retries = 3): Promise<boolean> {
    console.log('Entering updateState, message:', message);
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) {
        console.log('No PAT available for updating state');
        return false;
    }
    const fileContent = btoa(JSON.stringify(newContent, null, 2));
    try {
        const body: any = { message, content: fileContent, branch: 'main' };
        if (oldSha) body.sha = oldSha;
        console.log('Sending PUT request to update state');
        const response = await fetch(STATE_URL + '?ref=main', {
            method: 'PUT',
            headers: {
                'Authorization': `token ${githubAccessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            if (response.status === 409 && retries > 0) {
                console.log('Conflict detected, retrying...');
                const current = await fetchState();
                if (!current) throw new Error('Failed to refetch');
                return updateState(newContent, current.sha, message, retries - 1);
            }
            console.error('Error updating state:', response.status, await response.text());
            throw new Error(`Error updating state: ${response.statusText}`);
        }
        console.log('State updated successfully');
        return true;
    } catch (error) {
        console.error('Error updating state:', error);
        return false;
    }
}
// Close issue with comment
async function closeIssueWithComment(issueNumber: number, blockIndex: number | null, valid: boolean): Promise<void> {
    console.log('Entering closeIssueWithComment, issue:', issueNumber);
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) {
        console.log('No PAT available for closing issue');
        return;
    }
    const status = valid && blockIndex !== null ? `Confirmed in block ${blockIndex}` : 'Invalid transaction';
    const intro = "Gitchain is an innovative centralized chain on GitHub. It enables secure, transparent transactions.";
    const gitchain_url = `https://github.com/${FQ_REPO}`;
    const commentBody = `${status}. ${intro} Learn more: ${gitchain_url} (Repo: ${FQ_REPO})`;
    console.log('Creating comment for issue:', issueNumber);
    await fetch(`${ISSUES_URL}/${issueNumber}/comments`, {
        method: 'POST',
        headers: {
            'Authorization': `token ${githubAccessToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body: commentBody })
    });
    console.log('Closing issue:', issueNumber);
    await fetch(`${ISSUES_URL}/${issueNumber}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `token ${githubAccessToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ state: 'closed' })
    });
}
// Process txns via open issues
export async function processTxns(): Promise<void> {
    console.log('Entering processTxns');
    const output = document.getElementById('output') as HTMLDivElement;
    const processingMessage = document.getElementById('processing-message') as HTMLDivElement;
    processingMessage.classList.add('visible');
    let stateData = await fetchState();
    let state = stateData?.content;
    if (!state) {
        console.log('No state found, initializing');
        state = {
            chain: [createOriginalBlock()],
            pending: [],
            balances: { [ADMIN_ADDRESS]: 1000000 },
            nonces: {},
            lastProcessedDate: new Date(0).toISOString()
        };
        const success = await updateState(state, null, 'Initialize state');
        if (!success) {
            console.log('Failed to initialize state');
            output.textContent += '\nFailed to initialize.';
            processingMessage.classList.remove('visible');
            return;
        }
        stateData = await fetchState();
        state = stateData!.content;
    }
    console.log('Fetching open issues');
    const issuesRes = await fetch(`${ISSUES_URL}?state=open&sort=created&direction=asc&per_page=100`, {
        headers: { 'Authorization': `token ${getGithubAccessToken()}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    const issues = await issuesRes.json();
    let newLastDate = state.lastProcessedDate;
    for (const issue of issues) {
        if (!issue.title.toLowerCase().startsWith('tx')) continue;
        if (new Date(issue.created_at) <= new Date(state.lastProcessedDate)) continue;
        let txn: Transaction;
        try {
            const parsed = JSON.parse(issue.body);
            if (parsed.type !== 'gitchain_txn') {
                console.log('Skipping non-tx issue:', issue.number);
                await closeIssueWithComment(issue.number, null, false);
                continue;
            }
            if (parsed.repo !== FQ_REPO) {
                console.log('Skipping issue from wrong repo:', issue.number);
                await closeIssueWithComment(issue.number, null, false);
                continue;
            }
            txn = parsed.txn;
        } catch {
            console.log('Invalid issue body, closing:', issue.number);
            await closeIssueWithComment(issue.number, null, false);
            continue;
        }
        console.log('Processing transaction from issue:', issue.number);
        const { valid, txid } = await processTxn(txn, state);
        console.log(`Transaction ID: ${txid}, valid: ${valid}`);
        const blockIndex = valid ? await createBlock(state) : null;
        await closeIssueWithComment(issue.number, blockIndex, valid);
        if (valid && blockIndex !== null) {
            console.log(`Transaction ID: ${txid} settled in block ${blockIndex}`);
            output.textContent += `\nProcessed txn ${txid} from issue #${issue.number} in block ${blockIndex}`;
        } else {
            console.log(`Rejected invalid txn from issue #${issue.number}`);
            output.textContent += `\nRejected invalid txn from issue #${issue.number}`;
        }
        const success = await updateState(state, stateData!.sha, `Process issue #${issue.number}`);
        if (!success) {
            console.log('Failed to update state after issue:', issue.number);
            output.textContent += `\nFailed to update state after issue #${issue.number}`;
            processingMessage.classList.remove('visible');
            return;
        }
        stateData = await fetchState();
        state = stateData!.content;
        const issueCreated = issue.created_at;
        if (new Date(issueCreated) > new Date(newLastDate)) {
            newLastDate = issueCreated;
        }
    }
    if (newLastDate !== state.lastProcessedDate) {
        console.log('Updating last processed date:', newLastDate);
        state.lastProcessedDate = newLastDate;
        await updateState(state, stateData!.sha, 'Update last processed date');
    }
    console.log('processTxns completed');
    processingMessage.classList.remove('visible');
}
// View chain
export async function viewChain(): Promise<void> {
    console.log('Entering viewChain');
    const output = document.getElementById('output') as HTMLDivElement;
    const state = await fetchState();
    if (!state || !state.content.chain || state.content.chain.length === 0) {
        console.log('No transactions in chain');
        output.textContent = 'No transactions in the chain yet.';
        return;
    }
    const chain = state.content.chain;
    const balances = state.content.balances;
    let text = `Chain length: ${chain.length}\nPending txns: ${state.content.pending.length}\nLast processed: ${state.content.lastProcessedDate}\nBalances:\n`;
    for (const [addr, bal] of Object.entries(balances)) {
        text += ` ${addr}: ${bal}\n`;
    }
    text += '\n';
    chain.forEach(b => {
        text += `Block ${b.index}:\n` +
                ` Hash: ${b.hash}\n` +
                ` Prev Hash: ${b.previousHash}\n` +
                ` Timestamp: ${b.timestamp}\n` +
                ` Transactions:\n` +
                b.transactions.map(t => ` ${t.from} sends ${t.amount} to ${t.to} (nonce ${t.nonce})`).join('\n') + '\n\n';
    });
    output.textContent = text;
    console.log('viewChain completed, chain length:', chain.length);
}
// Expose libp2p and server peers
export function getLibp2p() {
    return libp2p;
}
export function getServerPeers() {
    return serverPeers;
}
// Auto-process and initialize
window.addEventListener('load', () => {
    console.log('Window loaded, checking for PAT');
    if (!localStorage.getItem(GITHUB_ACCESS_TOKEN_KEY)) {
        console.log('No PAT found, prompting user');
        alert('Enter your GitHub access token (repo contents read/write, issues read/write) and save.');
    } else {
        console.log('PAT found, initializing P2P as host');
        initP2P(true);
    }
    console.log('Setting interval for transaction processing');
    setInterval(() => {
        processTxns();
    }, UPDATE_INTERVAL);
});
// Unload event for removing peer ID
window.addEventListener('unload', async () => {
    await removeHostPeerId();
});
// Expose to window.gitchain
window.gitchain = {
    saveGithubAccessToken,
    viewChain,
    processTxns,
    fetchState,
    connectAndSendTx
};
// Dispatch event
window.dispatchEvent(new Event('gitchain:init'));
