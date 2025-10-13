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

// Declare Helia/libp2p globals for CDN
declare global {
  interface Window {
    createHelia: (options?: any) => Promise<any>;
    createLibp2p: (options?: any) => Promise<any>;
    webRTC: any;
    noise: any;
    yamux: any;
    multiaddr: (addr: string) => any;
    uint8arrays: {
      fromString: (s: string) => Uint8Array;
      toString: (u: Uint8Array) => string;
      concat: (arrays: Uint8Array[]) => Uint8Array;
    };
  }
}

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
const HOST_PEER_FILE = 'data/host-peer.json';
const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Global P2P state
let helia: any = null;
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
            alert('Please enter your GitHub access token.');
            return null;
        }
        localStorage.setItem(GITHUB_ACCESS_TOKEN_KEY, githubAccessToken);
    }
    return githubAccessToken;
}

// Initialize Helia/libp2p
async function initP2P(isHostMode: boolean) {
    isHost = isHostMode;
    const { createHelia, createLibp2p, webRTC, noise, yamux } = window;

    try {
        const libp2pNode = await createLibp2p({
            transports: [webRTC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })],
            connectionEncryption: [noise()],
            streamMuxers: [yamux()],
            addresses: {
                listen: ['/webrtc']
            }
        });

        helia = await createHelia({ libp2p: libp2pNode });
        libp2p = libp2pNode;
        await libp2p.start();

        // Ensure libp2p is fully initialized before advertising
        await new Promise(resolve => setTimeout(resolve, 500));

        libp2p.addEventListener('peer:connect', (evt: any) => {
            console.log('Connected to peer:', evt.detail.toString());
        });

        // Register protocol handler for incoming TX
        await libp2p.handle(PROTOCOL, async ({ stream, connection }: any) => {
            console.log('Incoming TX stream from', connection.remotePeer.toString());
            const txJson = await pipeToString(stream);
            try {
                const tx = JSON.parse(txJson) as Transaction;
                if (await verifyTxn(tx)) {
                    // Create GitHub issue with formatted body
                    const issueBody = JSON.stringify({
                        type: 'gitchain_txn',
                        repo: FQ_REPO,
                        txn: tx
                    });
                    const issueResponse = await fetch(ISSUES_URL, {
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
                    if (issueResponse.ok) {
                        console.log('Created issue for anonymous TX');
                    } else {
                        console.error('Failed to create issue:', await issueResponse.text());
                    }
                } else {
                    console.error('Invalid TX from P2P');
                }
            } catch (error) {
                console.error('Error processing TX:', error);
            }
            stream.close();
        });

        if (isHost) {
            // Advertise immediately and set interval
            await advertiseHostPeer();
            setInterval(advertiseHostPeer, UPDATE_INTERVAL);
            // Remove peer file on unload
            window.addEventListener('beforeunload', async () => {
                await deleteHostPeerFile();
            });
        }
    } catch (error) {
        console.error('Failed to initialize P2P:', error);
        if (isHost) {
            alert('Failed to initialize P2P node. Please check your network or contact the administrator.');
        }
    }
}

// Advertise host peer info to GitHub with retries
async function advertiseHostPeer(retries = 3, delayMs = 1000): Promise<boolean> {
    if (!isHost || !libp2p) return false;
    const peerId = libp2p.peerId.toString();
    const multiaddrs = libp2p.getMultiaddrs().map((ma: any) => ma.toString());
    const peerInfo = { peerId, multiaddrs, timestamp: Date.now() };
    const content = JSON.stringify(peerInfo, null, 2);

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
        try {
            const sha = await getFileSha(HOST_PEER_FILE);
            const body: any = {
                message: 'Update host peer info',
                content: btoa(content),
                branch: 'main'
            };
            if (sha) body.sha = sha; // Include SHA only if file exists
            const response = await fetch(`https://api.github.com/repos/${FQ_REPO}/contents/${HOST_PEER_FILE}`, {
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
                    if (attempt < retries) {
                        console.log(`Retrying after ${delayMs}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                        continue;
                    }
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
        } catch (error) {
            console.error(`Attempt ${attempt}/${retries} - Error advertising peer:`, error);
            if (attempt === retries) {
                alert('Failed to advertise host peer info. Ensure your PAT has repo scope and check API rate limits. Contact the administrator if the issue persists.');
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    return false;
}

// Delete host peer file on unload
async function deleteHostPeerFile(): Promise<void> {
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) return;

    try {
        const sha = await getFileSha(HOST_PEER_FILE);
        if (!sha) {
            console.log('No host peer file to delete');
            return;
        }
        const response = await fetch(`https://api.github.com/repos/${FQ_REPO}/contents/${HOST_PEER_FILE}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `token ${githubAccessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Remove host peer info on unload',
                sha
            })
        });
        if (response.ok) {
            console.log('Deleted host peer file');
        } else {
            console.error('Failed to delete peer file:', await response.text());
        }
    } catch (error) {
        console.error('Error deleting peer file:', error);
    }
}

// Get file SHA for updates/deletes
async function getFileSha(path: string): Promise<string | null> {
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) return null;
    try {
        const res = await fetch(`https://api.github.com/repos/${FQ_REPO}/contents/${path}?ref=main`, {
            headers: {
                'Authorization': `token ${githubAccessToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (res.ok) {
            const data = await res.json();
            return data.sha;
        }
        if (res.status === 404) {
            return null; // File doesn't exist
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
    if (isHost) {
        // Host uses direct issue creation
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
            console.error('Host failed to create issue:', await response.text());
        }
        return;
    }

    // Check for host peer file
    const res = await fetch(`https://raw.githubusercontent.com/${FQ_REPO}/main/${HOST_PEER_FILE}`);
    if (!res.ok) {
        alert('No server node connected. Please notify the blockchain administrator.');
        return;
    }
    const { peerId, multiaddrs, timestamp } = await res.json();

    // Check staleness (<10 min)
    if (Date.now() - timestamp > 10 * 60 * 1000) {
        console.warn('Stale host info, retry later');
        alert('Host peer info is stale. Try again later or notify the administrator.');
        return;
    }

    // Initialize P2P if not already
    if (!helia) {
        await initP2P(false);
    }

    // Dial host
    try {
        const ma = window.multiaddr(multiaddrs[0]);
        const connection = await libp2p.dial(ma);
        const stream = await connection.newStream(PROTOCOL);
        const txJson = JSON.stringify(tx);
        await pipeStringToStream(txJson, stream);
        console.log('TX sent via P2P');
    } catch (error) {
        console.error('Failed to connect or send TX:', error);
        alert('Failed to connect to host. Please try again or notify the administrator.');
    }
}

// Stream helpers
async function pipeToString(stream: any): Promise<string> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream.source) {
        chunks.push(chunk);
    }
    const data = window.uint8arrays.concat(chunks);
    return window.uint8arrays.toString(data);
}

async function pipeStringToStream(str: string, stream: any) {
    const data = window.uint8arrays.fromString(str);
    await stream.sink([data]);
}

// Save GitHub access token
export function saveGithubAccessToken(): void {
    const githubAccessToken = (document.getElementById('githubAccessToken') as HTMLInputElement)?.value;
    if (githubAccessToken) {
        localStorage.setItem(GITHUB_ACCESS_TOKEN_KEY, githubAccessToken);
        // Initialize as host and advertise peer info
        initP2P(true);
    } else {
        throw new Error('Enter a GitHub access token first.');
    }
}

// Fetch state
export async function fetchState(): Promise<{ content: State; sha: string } | null> {
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) return null;
    try {
        const response = await fetch(`${BASE_URL}?ref=main`, {
            headers: {
                'Authorization': `token ${githubAccessToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`Error fetching state: ${response.statusText}`);
        }
        const file = await response.json();
        const content: State = JSON.parse(atob(file.content));
        return { content, sha: file.sha };
    } catch (error) {
        console.error(error);
        return null;
    }
}

// Update state with retries
async function updateState(newContent: State, oldSha: string | null, message: string, retries = 3): Promise<boolean> {
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) return false;
    const fileContent = btoa(JSON.stringify(newContent, null, 2));
    try {
        const body: any = { message, content: fileContent, branch: 'main' };
        if (oldSha) body.sha = oldSha;
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
                console.log('Conflict, retrying...');
                const current = await fetchState();
                if (!current) throw new Error('Failed to refetch');
                return updateState(newContent, current.sha, message, retries - 1);
            }
            throw new Error(`Error updating state: ${response.statusText}`);
        }
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

// Close issue with comment
async function closeIssueWithComment(issueNumber: number, blockIndex: number | null, valid: boolean): Promise<void> {
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) return;
    const status = valid && blockIndex !== null ? `Confirmed in block ${blockIndex}` : 'Invalid transaction';
    const intro = "Gitchain is an innovative centralized blockchain using GitHub for storage and processing. It enables secure, transparent transactions via issues. Join the experiment in decentralized finance today!";
    const gitchain_url = `https://github.com/${FQ_REPO}`;
    const commentBody = `${status}. ${intro} Learn more: ${gitchain_url} (Repo: ${FQ_REPO})`;
    // Create comment
    await fetch(`${ISSUES_URL}/${issueNumber}/comments`, {
        method: 'POST',
        headers: {
            'Authorization': `token ${githubAccessToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body: commentBody })
    });
    // Close issue
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
    const output = document.getElementById('output') as HTMLDivElement;
    const processingMessage = document.getElementById('processingMessage') as HTMLDivElement;
    processingMessage.style.display = 'block';
    let stateData = await fetchState();
    let state = stateData?.content;
    if (!state) {
        state = {
            chain: [createGenesisBlock()],
            pending: [],
            balances: { [ADMIN_ADDRESS]: 1000000 },
            nonces: {},
            lastProcessedDate: new Date(0).toISOString()
        };
        const success = await updateState(state, null, 'Initialize state');
        if (!success) {
            output.textContent += '\nFailed to initialize.';
            processingMessage.style.display = 'none';
            return;
        }
        stateData = await fetchState();
        state = stateData!.content;
    }
    // Fetch open issues created since lastProcessedDate with "tx" in title
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
                await closeIssueWithComment(issue.number, null, false);
                continue;
            }
            if (parsed.repo !== FQ_REPO) {
                await closeIssueWithComment(issue.number, null, false);
                continue;
            }
            txn = parsed.txn;
        } catch {
            await closeIssueWithComment(issue.number, null, false);
            continue;
        }
        const { valid, txid } = await processTxn(txn, state);
        console.log(`Attempting to settle transaction ID: ${txid} from issue #${issue.number}`);
        const blockIndex = valid ? await mineBlock(state) : null;
        await closeIssueWithComment(issue.number, blockIndex, valid);
        if (valid && blockIndex !== null) {
            console.log(`Transaction ID: ${txid} settled in block ${blockIndex}`);
            output.textContent += `\nProcessed txn ${txid} from issue #${issue.number} in block ${blockIndex}`;
        } else {
            output.textContent += `\nRejected invalid txn from issue #${issue.number}`;
        }
        const success = await updateState(state, stateData!.sha, `Process issue #${issue.number}`);
        if (!success) {
            output.textContent += `\nFailed to update state after issue #${issue.number}`;
            processingMessage.style.display = 'none';
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
        state.lastProcessedDate = newLastDate;
        await updateState(state, stateData!.sha, 'Update last processed date');
    }
    processingMessage.style.display = 'none';
}

// View chain
export async function viewChain(): Promise<void> {
    const output = document.getElementById('output') as HTMLDivElement;
    const state = await fetchState();
    if (!state || !state.content.chain || state.content.chain.length === 0) {
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
}

// Auto-process every 15 seconds and initialize host if PAT exists
window.addEventListener('load', () => {
    if (!localStorage.getItem(GITHUB_ACCESS_TOKEN_KEY)) {
        alert('Enter your GitHub access token (repo contents read/write, issues read/write) and save.');
    } else {
        initP2P(true);
    }
    setInterval(() => {
        processTxns();
    }, 15000);
});
