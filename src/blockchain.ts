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

import { createLibp2p } from 'libp2p';
import { webRTC } from '@libp2p/webrtc';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { bootstrap } from '@libp2p/bootstrap';
import { multiaddr } from '@multiformats/multiaddr';
import { fromString as uint8FromString, toString as uint8ToString, concat as uint8Concat } from 'uint8arrays';

// Dynamic OWNER and REPO from URL
const hostnameParts = location.hostname.split('.');
const OWNER: string = hostnameParts[0];
const REPO: string = location.pathname === '/' || location.pathname === '' ? `${OWNER}.github.io` : location.pathname.split('/')[1];
const FQ_REPO: string = `${OWNER}/${REPO}`;
const STATE_PATH: string = 'data/state.json';
const BASE_URL: string = `https://api.github.com/repos/${FQ_REPO}/contents/${STATE_PATH}`;
const GITHUB_ACCESS_TOKEN_KEY: string = 'gitchain_github_access_token';
const ISSUES_URL: string = `https://api.github.com/repos/${FQ_REPO}/issues`;
// Constants for P2P
const PROTOCOL = '/gitchain/tx/1.0.0';
const SERVER_PEER_FILE = 'data/server-peer.json';
const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
// Global P2P state
let libp2p: any = null;
let isHost = false;
let lastPeerInfo: string | null = null; // Track for change detection
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
function createGenesisBlock(): Block {
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
// Mine block
async function mineBlock(state: State): Promise<number | null> {
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
        githubAccessToken = (document.getElementById('githubAccessToken') as HTMLInputElement)?.value;
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
    isHost = host;
    let bootstrapList: string[] = [];
    if (isHost) {
        try {
            const response = await fetch(`/${SERVER_PEER_FILE}`);
            if (response.ok) {
                const peerData = await response.json();
                console.log('Raw peer data from server-peer.json:', peerData);
                bootstrapList = (peerData.peers || []).filter((addr: string) => {
                    try {
                        multiaddr(addr); // Validate multiaddr
                        console.log(`Valid multiaddr: ${addr}`);
                        return true;
                    } catch (e) {
                        console.error(`Invalid multiaddr in server-peer.json: ${addr}`, e);
                        return false;
                    }
                });
                console.log('Filtered bootstrapList:', bootstrapList);
            } else if (response.status === 404) {
                console.log('server-peer.json not found, creating with host peerInfo');
                const githubAccessToken = getGithubAccessToken();
                if (!githubAccessToken) {
                    console.log('No PAT available for creating server-peer.json');
                } else {
                    // Generate peerInfo early for creation
                    const tempConfig = {
                        transports: [webRTC(), circuitRelayTransport()],
                        connectionEncryption: [noise()],
                        streamMuxers: [yamux()],
                        services: { identify: identify() }
                    };
                    const tempNode = await createLibp2p(tempConfig);
                    const peerInfo = `/ip4/0.0.0.0/tcp/0/p2p/${tempNode.peerId.toString()}`;
                    await tempNode.stop(); // Close temp node
                    const initialContent = uint8ToString(uint8Concat([new TextEncoder().encode(JSON.stringify({ peers: [peerInfo] }))]), 'base64');
                    const createResponse = await fetch(`https://api.github.com/repos/${FQ_REPO}/contents/${SERVER_PEER_FILE}`, {
                        method: 'PUT',
                        headers: {
                            'Authorization': `token ${githubAccessToken}`,
                            'Accept': 'application/vnd.github.v3+json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            message: 'Create server-peer.json with host peer',
                            content: initialContent
                        })
                    });
                    if (createResponse.ok) {
                        console.log('server-peer.json created successfully with host peerInfo');
                    } else {
                        console.error('Failed to create server-peer.json:', await createResponse.text());
                    }
                }
            } else {
                console.log('Error fetching server-peer.json, status:', response.status);
            }
        } catch (error) {
            console.error('Error loading/creating server-peer.json:', error);
        }
    }
    try {
        const config: any = {
            transports: [webRTC(), circuitRelayTransport()],
            connectionEncryption: [noise()],
            streamMuxers: [yamux()],
            services: { identify: identify() }
        };
        if (bootstrapList.length) {
            config.peerDiscovery = [bootstrap({ list: bootstrapList })];
        } else {
            console.log('No valid peers in bootstrapList, initializing libp2p without peer discovery');
        }
        libp2p = await createLibp2p(config);
        console.log('P2P node started:', libp2p.peerId.toString());
        if (isHost) {
            const peerInfo = `/ip4/0.0.0.0/tcp/0/p2p/${libp2p.peerId.toString()}`;
            if (peerInfo !== lastPeerInfo) {
                console.log('Updating server-peer.json with:', peerInfo);
                const githubAccessToken = getGithubAccessToken();
                if (!githubAccessToken) {
                    console.log('No PAT available for updating server-peer.json');
                    return;
                }
                try {
                    const response = await fetch(`https://api.github.com/repos/${FQ_REPO}/contents/${SERVER_PEER_FILE}`, {
                        headers: {
                            'Authorization': `token ${githubAccessToken}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });
                    let sha: string | null = null;
                    if (response.ok) {
                        const data = await response.json();
                        sha = data.sha;
                    }
                    await fetch(`https://api.github.com/repos/${FQ_REPO}/contents/${SERVER_PEER_FILE}`, {
                        method: sha ? 'PUT' : 'POST',
                        headers: {
                            'Authorization': `token ${githubAccessToken}`,
                            'Accept': 'application/vnd.github.v3+json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            message: 'Update server peer info',
                            content: uint8ToString(uint8Concat([new TextEncoder().encode(JSON.stringify({ peers: [peerInfo] }))]), 'base64'),
                            sha
                        })
                    });
                    lastPeerInfo = peerInfo;
                } catch (error) {
                    console.error('Error updating server-peer.json:', error);
                }
            }
        }
        libp2p.addEventListener('peer:discovery', (evt: any) => {
            console.log('Peer discovered:', evt.detail.id.toString());
        });
        await libp2p.handle(PROTOCOL, async ({ stream, connection }: any) => {
            console.log('Received P2P stream from:', connection.remotePeer.toString());
            const data = await stream.read();
            const txn = JSON.parse(uint8ToString(data));
            console.log('Received transaction via P2P:', txn);
        });
    } catch (error) {
        console.error('Failed to initialize P2P:', error);
    }
}

// Advertise server peer info to GitHub with retries
async function advertiseServerPeer(retries = 3, delayMs = 1000): Promise<boolean> {
    console.log('Entering advertiseServerPeer, retries:', retries);
    if (!isHost || !libp2p) {
        console.log('Not in host mode or libp2p not initialized');
        return false;
    }
    const peerId = libp2p.peerId.toString();
    const multiaddrs = libp2p.getMultiaddrs().map((ma: any) => ma.toString());
    const peerInfo = { peerId, multiaddrs, timestamp: Date.now() };
    const content = JSON.stringify(peerInfo, null, 2);
    console.log('Peer info to advertise:', content);
    // Only update if changed
    if (content === lastPeerInfo) {
        console.log('No change in peer info, skipping update');
        return true;
    }
    lastPeerInfo = content;
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) {
        console.error('No PAT available for advertising peer');
        return false;
    }
    for (let attempt = 1; attempt <= retries; attempt++) {
        console.log(`Attempt ${attempt}/${retries} to advertise peer info`);
        try {
            console.log('Fetching SHA for', SERVER_PEER_FILE);
            const sha = await getFileSha(SERVER_PEER_FILE);
            console.log('SHA:', sha || 'none (new file)');
            const body: any = {
                message: 'Update server peer info',
                content: btoa(content),
                branch: 'main'
            };
            if (sha) body.sha = sha;
            console.log('Sending PUT request to:', `https://api.github.com/repos/${FQ_REPO}/contents/${SERVER_PEER_FILE}`);
            const response = await fetch(`https://api.github.com/repos/${FQ_REPO}/contents/${SERVER_PEER_FILE}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${githubAccessToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (response.ok) {
                console.log('Advertised peer info successfully');
                return true;
            } else {
                const errorText = await response.text();
                console.error(`Attempt ${attempt}/${retries} - Failed to advertise peer: ${response.status} ${errorText}`);
                if (response.status === 403 || response.status === 429) {
                    console.log(`Retrying after ${delayMs}ms due to ${response.status}`);
                    if (attempt < retries) {
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                        continue;
                    }
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
        } catch (error) {
            console.error(`Attempt ${attempt}/${retries} - Error advertising peer:`, error);
            if (attempt === retries) {
                console.error('All retries failed, alerting user');
                alert('Failed to advertise server peer info. Ensure your PAT has repo scope and check API rate limits. Contact the administrator if the issue persists.');
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    console.log('Exiting advertiseServerPeer, failed after all retries');
    return false;
}
// Delete server peer file on unload
async function deleteServerPeerFile(): Promise<void> {
    console.log('Entering deleteServerPeerFile');
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) {
        console.log('No PAT available for deleting server peer file');
        return;
    }
    try {
        console.log('Fetching SHA for', SERVER_PEER_FILE);
        const sha = await getFileSha(SERVER_PEER_FILE);
        if (!sha) {
            console.log('No server peer file to delete');
            return;
        }
        console.log('Sending DELETE request for', SERVER_PEER_FILE);
        const response = await fetch(`https://api.github.com/repos/${FQ_REPO}/contents/${SERVER_PEER_FILE}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `token ${githubAccessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Remove server peer info on unload',
                sha
            })
        });
        if (response.ok) {
            console.log('Deleted server peer file successfully');
        } else {
            console.error('Failed to delete peer file:', response.status, await response.text());
        }
    } catch (error) {
        console.error('Error deleting peer file:', error);
    }
}
// Get file SHA for updates/deletes
async function getFileSha(path: string): Promise<string | null> {
    console.log('Entering getFileSha for', path);
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) {
        console.log('No PAT available for fetching SHA');
        return null;
    }
    try {
        console.log('Fetching SHA from:', `https://api.github.com/repos/${FQ_REPO}/contents/${path}?ref=main`);
        const res = await fetch(`https://api.github.com/repos/${FQ_REPO}/contents/${path}?ref=main`, {
            headers: {
                'Authorization': `token ${githubAccessToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (res.ok) {
            const data = await res.json();
            console.log('SHA retrieved:', data.sha);
            return data.sha;
        }
        if (res.status === 404) {
            console.log('File does not exist, returning null SHA');
            return null;
        }
        console.error(`Failed to fetch SHA for ${path}: ${res.status} ${await res.text()}`);
        return null;
    } catch (error) {
        console.error(`Error fetching SHA for ${path}:`, error);
        return null;
    }
}
// Client-side: Connect and send TX
export async function connectAndSendTx(tx: Transaction) {
    console.log('Entering connectAndSendTx, tx:', tx);
    if (isHost) {
        console.log('Host mode: Creating issue directly');
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
    console.log('Client mode: Fetching server peer file');
    const res = await fetch(`https://raw.githubusercontent.com/${FQ_REPO}/main/${SERVER_PEER_FILE}`);
    if (!res.ok) {
        console.error('Failed to fetch server peer file:', res.status, await res.text());
        if (res.status === 404) {
            alert('The server is currently not running. Please notify the blockchain/project administrator.');
        } else {
            alert('Failed to fetch server peer info. Please try again or notify the administrator.');
        }
        return;
    }
    const { peerId, multiaddrs, timestamp } = await res.json();
    console.log('Server peer info:', { peerId, multiaddrs, timestamp });
    if (Date.now() - timestamp > 10 * 60 * 1000) {
        console.warn('Stale server info, timestamp:', timestamp);
        alert('Server peer info is stale. Try again later or notify the administrator.');
        return;
    }
    if (!libp2p) {
        console.log('Initializing P2P for client');
        await initP2P(false);
    }
    try {
        console.log('Dialing server multiaddr:', multiaddrs[0]);
        const ma = multiaddr(multiaddrs[0]);
        const connection = await libp2p.dial(ma);
        console.log('Connected to server, creating stream for:', PROTOCOL);
        const stream = await connection.newStream(PROTOCOL);
        const txJson = JSON.stringify(tx);
        await pipeStringToStream(txJson, stream);
        console.log('TX sent via P2P');
    } catch (error) {
        console.error('Failed to connect or send TX:', error);
        alert('Failed to connect to server. Please try again or notify the administrator.');
    }
}
// Stream helpers
async function pipeToString(stream: any): Promise<string> {
    console.log('Reading stream to string');
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream.source) {
        chunks.push(chunk);
    }
    const data = uint8Concat(chunks);
    const result = uint8ToString(data);
    console.log('Stream read complete, length:', result.length);
    return result;
}
async function pipeStringToStream(str: string, stream: any) {
    console.log('Writing string to stream, length:', str.length);
    const data = uint8FromString(str);
    await stream.sink([data]);
    console.log('String written to stream');
}
// Save GitHub access token
export function saveGithubAccessToken(): void {
    console.log('Entering saveGithubAccessToken');
    const githubAccessToken = (document.getElementById('githubAccessToken') as HTMLInputElement)?.value;
    if (githubAccessToken) {
        localStorage.setItem(GITHUB_ACCESS_TOKEN_KEY, githubAccessToken);
        console.log('PAT saved, initializing P2P as host');
        initP2P(true);
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
        console.log('Fetching state from:', BASE_URL);
        const response = await fetch(`${BASE_URL}?ref=main`, {
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
        const response = await fetch(BASE_URL, {
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
    const intro = "Gitchain is an innovative centralized blockchain using GitHub for storage and processing. It enables secure, transparent transactions via issues. Join the experiment in decentralized finance today!";
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
    const processingMessage = document.getElementById('processingMessage') as HTMLDivElement;
    processingMessage.classList.add('visible');
    let stateData = await fetchState();
    let state = stateData?.content;
    if (!state) {
        console.log('No state found, initializing');
        state = {
            chain: [createGenesisBlock()],
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
                console.log('Skipping non-gitchain issue:', issue.number);
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
        const blockIndex = valid ? await mineBlock(state) : null;
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
// Auto-process every 15 seconds and initialize host if PAT exists
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
    }, 15000);
});

// Expose functions to window.gitchain
window.gitchain = {
    saveGithubAccessToken,
    viewChain,
    processTxns,
    fetchState
};

// Dispatch custom event to signal main.js
window.dispatchEvent(new Event('gitchain:init'));
