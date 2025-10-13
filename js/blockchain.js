import { ADMIN_ADDRESS } from './admin-address.js';
// Dynamic OWNER and REPO from URL
const hostnameParts = location.hostname.split('.');
const OWNER = hostnameParts[0];
const REPO = location.pathname === '/' || location.pathname === '' ? `${OWNER}.github.io` : location.pathname.split('/')[1];
const FQ_REPO = `${OWNER}/${REPO}`;
const STATE_PATH = 'data/state.json';
const BASE_URL = `https://api.github.com/repos/${FQ_REPO}/contents/${STATE_PATH}`;
const GITHUB_ACCESS_TOKEN_KEY = 'gitchain_github_access_token';
const ISSUES_URL = `https://api.github.com/repos/${FQ_REPO}/issues`;
// Constants for P2P
const PROTOCOL = '/gitchain/tx/1.0.0';
const HOST_PEER_FILE = 'data/host-peer.json';
const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
// Global P2P state
let helia = null;
let libp2p = null;
let isHost = false;
let lastPeerInfo = null; // Track for change detection
// Calculate hash
function calculateHash(index, previousHash, timestamp, transactions) {
    const value = `${index}${previousHash}${timestamp}${JSON.stringify(transactions)}`;
    return CryptoJS.SHA256(value).toString();
}
// Create genesis block
function createGenesisBlock() {
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
function serializeTxn(txn) {
    return JSON.stringify(txn, Object.keys(txn).sort());
}
// Keccak256 using js-sha3
function keccak256(data) {
    const hex = sha3.keccak256(data);
    const matches = hex.match(/.{2}/g);
    if (!matches) {
        throw new Error('Failed to parse hex string');
    }
    return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}
// Hex to bytes
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}
// Bytes to hex
function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
// Verify signature using elliptic
function verifyTxn(txn) {
    try {
        const msgHash = keccak256(serializeTxn({ from: txn.from, to: txn.to, amount: txn.amount, nonce: txn.nonce }));
        const sigBytes = hexToBytes(txn.signature);
        if (sigBytes.length !== 65)
            return false;
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
    }
    catch {
        return false;
    }
}
// Process a single txn (mint if from admin)
async function processTxn(txn, state) {
    const txid = bytesToHex(keccak256(serializeTxn({ from: txn.from, to: txn.to, amount: txn.amount, nonce: txn.nonce })));
    if (!verifyTxn(txn))
        return { valid: false, txid };
    if ((state.nonces[txn.from] || 0) + 1 !== txn.nonce)
        return { valid: false, txid };
    if (txn.from.toLowerCase() !== ADMIN_ADDRESS.toLowerCase() && (state.balances[txn.from] || 0) < txn.amount)
        return { valid: false, txid };
    if (!/^0x[a-fA-F0-9]{40}$/.test(txn.from) || !/^0x[a-fA-F0-9]{40}$/.test(txn.to))
        return { valid: false, txid };
    state.pending.push(txn);
    return { valid: true, txid };
}
// Mine block
async function mineBlock(state) {
    if (state.pending.length === 0)
        return null;
    const validTxns = [];
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
    const newBlock = { index: nextIndex, previousHash, timestamp, transactions: validTxns, hash };
    state.chain.push(newBlock);
    state.pending = [];
    state.balances = newBalances;
    state.nonces = newNonces;
    return nextIndex;
}
// Get GitHub access token
function getGithubAccessToken() {
    let githubAccessToken = localStorage.getItem(GITHUB_ACCESS_TOKEN_KEY);
    if (!githubAccessToken) {
        githubAccessToken = document.getElementById('githubAccessToken')?.value;
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
// Initialize Helia/libp2p
async function initP2P(isHostMode) {
    console.log('Entering initP2P, isHost:', isHostMode);
    isHost = isHostMode;
    const { createHelia, createLibp2p, webRTC, noise, yamux } = window;
    try {
        console.log('Creating libp2p node...');
        const libp2pNode = await createLibp2p({
            transports: [webRTC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })],
            connectionEncryption: [noise()],
            streamMuxers: [yamux()],
            addresses: {
                listen: ['/webrtc']
            }
        });
        console.log('Creating Helia instance...');
        helia = await createHelia({ libp2p: libp2pNode });
        libp2p = libp2pNode;
        console.log('Starting libp2p node...');
        await libp2p.start();
        console.log('libp2p started, peerId:', libp2p.peerId.toString());
        // Ensure libp2p is fully initialized
        console.log('Waiting for libp2p initialization...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        libp2p.addEventListener('peer:connect', (evt) => {
            console.log('Connected to peer:', evt.detail.toString());
        });
        // Register protocol handler for incoming TX
        console.log('Registering protocol handler for:', PROTOCOL);
        await libp2p.handle(PROTOCOL, async ({ stream, connection }) => {
            console.log('Incoming TX stream from', connection.remotePeer.toString());
            const txJson = await pipeToString(stream);
            try {
                const tx = JSON.parse(txJson);
                if (await verifyTxn(tx)) {
                    console.log('Valid TX received, creating GitHub issue');
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
                    }
                    else {
                        console.error('Failed to create issue:', issueResponse.status, await issueResponse.text());
                    }
                }
                else {
                    console.error('Invalid TX from P2P');
                }
            }
            catch (error) {
                console.error('Error processing TX:', error);
            }
            stream.close();
        });
        if (isHost) {
            console.log('Host mode: Advertising peer info');
            await advertiseHostPeer();
            console.log('Setting interval for periodic peer advertising');
            setInterval(advertiseHostPeer, UPDATE_INTERVAL);
            window.addEventListener('beforeunload', async () => {
                console.log('Window unloading, deleting host peer file');
                await deleteHostPeerFile();
            });
        }
        console.log('initP2P completed successfully');
    }
    catch (error) {
        console.error('Failed to initialize P2P:', error);
        if (isHost) {
            alert('Failed to initialize P2P node. Please check your network or contact the administrator.');
        }
    }
}
// Advertise host peer info to GitHub with retries
async function advertiseHostPeer(retries = 3, delayMs = 1000) {
    console.log('Entering advertiseHostPeer, retries:', retries);
    if (!isHost || !libp2p) {
        console.log('Not in host mode or libp2p not initialized');
        return false;
    }
    const peerId = libp2p.peerId.toString();
    const multiaddrs = libp2p.getMultiaddrs().map((ma) => ma.toString());
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
            console.log('Fetching SHA for', HOST_PEER_FILE);
            const sha = await getFileSha(HOST_PEER_FILE);
            console.log('SHA:', sha || 'none (new file)');
            const body = {
                message: 'Update host peer info',
                content: btoa(content),
                branch: 'main'
            };
            if (sha)
                body.sha = sha;
            console.log('Sending PUT request to:', `https://api.github.com/repos/${FQ_REPO}/contents/${HOST_PEER_FILE}`);
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
            }
            else {
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
        }
        catch (error) {
            console.error(`Attempt ${attempt}/${retries} - Error advertising peer:`, error);
            if (attempt === retries) {
                console.error('All retries failed, alerting user');
                alert('Failed to advertise host peer info. Ensure your PAT has repo scope and check API rate limits. Contact the administrator if the issue persists.');
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    console.log('Exiting advertiseHostPeer, failed after all retries');
    return false;
}
// Delete host peer file on unload
async function deleteHostPeerFile() {
    console.log('Entering deleteHostPeerFile');
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) {
        console.log('No PAT available for deleting host peer file');
        return;
    }
    try {
        console.log('Fetching SHA for', HOST_PEER_FILE);
        const sha = await getFileSha(HOST_PEER_FILE);
        if (!sha) {
            console.log('No host peer file to delete');
            return;
        }
        console.log('Sending DELETE request for', HOST_PEER_FILE);
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
            console.log('Deleted host peer file successfully');
        }
        else {
            console.error('Failed to delete peer file:', response.status, await response.text());
        }
    }
    catch (error) {
        console.error('Error deleting peer file:', error);
    }
}
// Get file SHA for updates/deletes
async function getFileSha(path) {
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
    }
    catch (error) {
        console.error(`Error fetching SHA for ${path}:`, error);
        return null;
    }
}
// Client-side: Connect and send TX
export async function connectAndSendTx(tx) {
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
        }
        else {
            console.error('Host failed to create issue:', response.status, await response.text());
        }
        return;
    }
    console.log('Client mode: Fetching host peer file');
    const res = await fetch(`https://raw.githubusercontent.com/${FQ_REPO}/main/${HOST_PEER_FILE}`);
    if (!res.ok) {
        console.error('Failed to fetch host peer file:', res.status, await res.text());
        alert('No server node connected. Please notify the blockchain administrator.');
        return;
    }
    const { peerId, multiaddrs, timestamp } = await res.json();
    console.log('Host peer info:', { peerId, multiaddrs, timestamp });
    if (Date.now() - timestamp > 10 * 60 * 1000) {
        console.warn('Stale host info, timestamp:', timestamp);
        alert('Host peer info is stale. Try again later or notify the administrator.');
        return;
    }
    if (!helia) {
        console.log('Initializing P2P for client');
        await initP2P(false);
    }
    try {
        console.log('Dialing host multiaddr:', multiaddrs[0]);
        const ma = window.multiaddr(multiaddrs[0]);
        const connection = await libp2p.dial(ma);
        console.log('Connected to host, creating stream for:', PROTOCOL);
        const stream = await connection.newStream(PROTOCOL);
        const txJson = JSON.stringify(tx);
        await pipeStringToStream(txJson, stream);
        console.log('TX sent via P2P');
    }
    catch (error) {
        console.error('Failed to connect or send TX:', error);
        alert('Failed to connect to host. Please try again or notify the administrator.');
    }
}
// Stream helpers
async function pipeToString(stream) {
    console.log('Reading stream to string');
    const chunks = [];
    for await (const chunk of stream.source) {
        chunks.push(chunk);
    }
    const data = window.uint8arrays.concat(chunks);
    const result = window.uint8arrays.toString(data);
    console.log('Stream read complete, length:', result.length);
    return result;
}
async function pipeStringToStream(str, stream) {
    console.log('Writing string to stream, length:', str.length);
    const data = window.uint8arrays.fromString(str);
    await stream.sink([data]);
    console.log('String written to stream');
}
// Save GitHub access token
export function saveGithubAccessToken() {
    console.log('Entering saveGithubAccessToken');
    const githubAccessToken = document.getElementById('githubAccessToken')?.value;
    if (githubAccessToken) {
        localStorage.setItem(GITHUB_ACCESS_TOKEN_KEY, githubAccessToken);
        console.log('PAT saved, initializing P2P as host');
        initP2P(true);
    }
    else {
        console.error('No GitHub access token provided');
        throw new Error('Enter a GitHub access token first.');
    }
}
// Fetch state
export async function fetchState() {
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
        const content = JSON.parse(atob(file.content));
        console.log('State fetched, chain length:', content.chain.length);
        return { content, sha: file.sha };
    }
    catch (error) {
        console.error('Error fetching state:', error);
        return null;
    }
}
// Update state with retries
async function updateState(newContent, oldSha, message, retries = 3) {
    console.log('Entering updateState, message:', message);
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken) {
        console.log('No PAT available for updating state');
        return false;
    }
    const fileContent = btoa(JSON.stringify(newContent, null, 2));
    try {
        const body = { message, content: fileContent, branch: 'main' };
        if (oldSha)
            body.sha = oldSha;
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
                if (!current)
                    throw new Error('Failed to refetch');
                return updateState(newContent, current.sha, message, retries - 1);
            }
            console.error('Error updating state:', response.status, await response.text());
            throw new Error(`Error updating state: ${response.statusText}`);
        }
        console.log('State updated successfully');
        return true;
    }
    catch (error) {
        console.error('Error updating state:', error);
        return false;
    }
}
// Close issue with comment
async function closeIssueWithComment(issueNumber, blockIndex, valid) {
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
export async function processTxns() {
    console.log('Entering processTxns');
    const output = document.getElementById('output');
    const processingMessage = document.getElementById('processingMessage');
    processingMessage.style.display = 'block';
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
            processingMessage.style.display = 'none';
            return;
        }
        stateData = await fetchState();
        state = stateData.content;
    }
    console.log('Fetching open issues');
    const issuesRes = await fetch(`${ISSUES_URL}?state=open&sort=created&direction=asc&per_page=100`, {
        headers: { 'Authorization': `token ${getGithubAccessToken()}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    const issues = await issuesRes.json();
    let newLastDate = state.lastProcessedDate;
    for (const issue of issues) {
        if (!issue.title.toLowerCase().startsWith('tx'))
            continue;
        if (new Date(issue.created_at) <= new Date(state.lastProcessedDate))
            continue;
        let txn;
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
        }
        catch {
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
        }
        else {
            console.log(`Rejected invalid txn from issue #${issue.number}`);
            output.textContent += `\nRejected invalid txn from issue #${issue.number}`;
        }
        const success = await updateState(state, stateData.sha, `Process issue #${issue.number}`);
        if (!success) {
            console.log('Failed to update state after issue:', issue.number);
            output.textContent += `\nFailed to update state after issue #${issue.number}`;
            processingMessage.style.display = 'none';
            return;
        }
        stateData = await fetchState();
        state = stateData.content;
        const issueCreated = issue.created_at;
        if (new Date(issueCreated) > new Date(newLastDate)) {
            newLastDate = issueCreated;
        }
    }
    if (newLastDate !== state.lastProcessedDate) {
        console.log('Updating last processed date:', newLastDate);
        state.lastProcessedDate = newLastDate;
        await updateState(state, stateData.sha, 'Update last processed date');
    }
    console.log('processTxns completed');
    processingMessage.style.display = 'none';
}
// View chain
export async function viewChain() {
    console.log('Entering viewChain');
    const output = document.getElementById('output');
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
    }
    else {
        console.log('PAT found, initializing P2P as host');
        initP2P(true);
    }
    console.log('Setting interval for transaction processing');
    setInterval(() => {
        processTxns();
    }, 15000);
});
