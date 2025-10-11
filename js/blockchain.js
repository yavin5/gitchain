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
// Keccak256 using polyfill
function keccak256(data) {
    const hasher = new Keccak(256);
    hasher.update(data);
    const hex = hasher.digest('hex');
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
        const curve = new ec.curves.secp256k1;
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
            alert('Please enter your GitHub access token.');
            return null;
        }
        localStorage.setItem(GITHUB_ACCESS_TOKEN_KEY, githubAccessToken);
    }
    return githubAccessToken;
}
// Save GitHub access token
export function saveGithubAccessToken() {
    const githubAccessToken = document.getElementById('githubAccessToken')?.value;
    if (githubAccessToken) {
        localStorage.setItem(GITHUB_ACCESS_TOKEN_KEY, githubAccessToken);
        alert('GitHub access token saved.');
    }
    else {
        alert('Enter a GitHub access token first.');
    }
}
// Fetch state
async function fetchState() {
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken)
        return null;
    try {
        const response = await fetch(`${BASE_URL}?ref=main`, {
            headers: {
                'Authorization': `token ${githubAccessToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (!response.ok) {
            if (response.status === 404)
                return null;
            throw new Error(`Error fetching state: ${response.statusText}`);
        }
        const file = await response.json();
        const content = JSON.parse(atob(file.content));
        return { content, sha: file.sha };
    }
    catch (error) {
        console.error(error);
        return null;
    }
}
// Update state with retries
async function updateState(newContent, oldSha, message, retries = 3) {
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken)
        return false;
    const fileContent = btoa(JSON.stringify(newContent, null, 2));
    try {
        const body = { message, content: fileContent, branch: 'main' };
        if (oldSha)
            body.sha = oldSha;
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
                if (!current)
                    throw new Error('Failed to refetch');
                return updateState(newContent, current.sha, message, retries - 1);
            }
            throw new Error(`Error updating state: ${response.statusText}`);
        }
        return true;
    }
    catch (error) {
        console.error(error);
        return false;
    }
}
// Close issue with comment
async function closeIssueWithComment(issueNumber, blockIndex, valid) {
    const githubAccessToken = getGithubAccessToken();
    if (!githubAccessToken)
        return;
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
export async function processTxns() {
    const output = document.getElementById('output');
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
            return;
        }
        stateData = await fetchState();
        state = stateData.content;
    }
    // Fetch open issues created since lastProcessedDate with "tx" in title
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
                await closeIssueWithComment(issue.number, null, false);
                continue;
            }
            if (parsed.repo !== FQ_REPO) {
                await closeIssueWithComment(issue.number, null, false);
                continue;
            }
            txn = parsed.txn;
        }
        catch {
            await closeIssueWithComment(issue.number, null, false);
            continue;
        }
        const { valid, txid } = await processTxn(txn, state);
        const blockIndex = valid ? await mineBlock(state) : null;
        await closeIssueWithComment(issue.number, blockIndex, valid);
        if (valid) {
            output.textContent += `\nProcessed txn ${txid} from issue #${issue.number} in block ${blockIndex}`;
        }
        else {
            output.textContent += `\nRejected invalid txn from issue #${issue.number}`;
        }
        const success = await updateState(state, stateData.sha, `Process issue #${issue.number}`);
        if (!success) {
            output.textContent += `\nFailed to update state after issue #${issue.number}`;
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
        state.lastProcessedDate = newLastDate;
        await updateState(state, stateData.sha, 'Update last processed date');
    }
    output.textContent += '\nProcessing complete';
}
// View chain
export async function viewChain() {
    const output = document.getElementById('output');
    const state = await fetchState();
    if (!state) {
        output.textContent = 'Chain not initialized.';
        return;
    }
    const chain = state.content.chain;
    const balances = state.content.balances;
    let text = `Chain length: ${chain.length}\nPending txns: ${state.content.pending.length}\nLast processed: ${state.content.lastProcessedDate}\nBalances:\n`;
    for (const [addr, bal] of Object.entries(balances)) {
        text += `  ${addr}: ${bal}\n`;
    }
    text += '\n';
    chain.forEach(b => {
        text += `Block ${b.index}:\n` +
            `  Hash: ${b.hash}\n` +
            `  Prev Hash: ${b.previousHash}\n` +
            `  Timestamp: ${b.timestamp}\n` +
            `  Transactions:\n` +
            b.transactions.map(t => `    ${t.from} sends ${t.amount} to ${t.to} (nonce ${t.nonce})`).join('\n') + '\n\n';
    });
    output.textContent = text;
}
// Auto-process every 15 seconds
window.addEventListener('load', () => {
    if (!localStorage.getItem(GITHUB_ACCESS_TOKEN_KEY)) {
        alert('Enter your GitHub access token (repo contents read/write, issues read/write) and save.');
    }
    setInterval(() => {
        processTxns();
    }, 15000);
});
