import { ADMIN_ADDRESS } from './admin-address';

// Dynamic OWNER and REPO from URL
const hostnameParts = location.hostname.split('.');
const OWNER: string = hostnameParts[0];
const REPO: string = location.pathname === '/' || location.pathname === '' ? `${OWNER}.github.io` : location.pathname.split('/')[1];
const FQ_REPO: string = `${OWNER}/${REPO}`;
const STATE_PATH: string = 'data/state.json';
const BASE_URL: string = `https://api.github.com/repos/${FQ_REPO}/contents/${STATE_PATH}`;
const GITHUB_ACCESS_TOKEN_KEY: string = 'gitchain_github_access_token';
const ISSUES_URL: string = `https://api.github.com/repos/${FQ_REPO}/issues`;

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

// Save GitHub access token
(window as any).saveGithubAccessToken = function(): void {
    const githubAccessToken = (document.getElementById('githubAccessToken') as HTMLInputElement)?.value;
    if (githubAccessToken) {
        localStorage.setItem(GITHUB_ACCESS_TOKEN_KEY, githubAccessToken);
        alert('GitHub access token saved.');
    } else {
        alert('Enter a GitHub access token first.');
    }
};

// Fetch state
async function fetchState(): Promise<{ content: State; sha: string } | null> {
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

// Serialize txn for signing/hash
function serializeTxn(txn: Omit<Transaction, 'signature'>): string {
    return JSON.stringify(txn, Object.keys(txn).sort());
}

// Verify signature
function verifyTxn(txn: Transaction): boolean {
    try {
        const msgHash = (window as any).ethereumCryptography.keccak256(new TextEncoder().encode(serializeTxn({ from: txn.from, to: txn.to, amount: txn.amount, nonce: txn.nonce })));
        const sigBytes = (window as any).ethereumCryptography.hexToBytes(txn.signature);
        if (sigBytes.length !== 65) return false;
        const r = sigBytes.slice(0, 32);
        const s = sigBytes.slice(32, 64);
        const v = sigBytes[64];
        const pubKey = (window as any).ethereumCryptography.secp256k1.recoverPublicKey(msgHash, { r, s }, v - 27);
        const addrHash = (window as any).ethereumCryptography.keccak256(pubKey.slice(1)).slice(-20);
        const recoveredAddr = `0x${(window as any).ethereumCryptography.bytesToHex(addrHash)}`;
        return recoveredAddr.toLowerCase() === txn.from.toLowerCase();
    } catch {
        return false;
    }
}

// Process a single txn (mint if from admin)
async function processTxn(txn: Transaction, state: State): Promise<{ valid: boolean; txid: string }> {
    const txid = (window as any).ethereumCryptography.bytesToHex((window as any).ethereumCryptography.keccak256(new TextEncoder().encode(serializeTxn({ from: txn.from, to: txn.to, amount: txn.amount, nonce: txn.nonce }))));
    if (!verifyTxn(txn)) return { valid: false, txid };
    if ((state.nonces[txn.from] || 0) + 1 !== txn.nonce) return { valid: false, txid };
    if (txn.from.toLowerCase() !== ADMIN_ADDRESS.toLowerCase() && (state.balances[txn.from] || 0) < txn.amount) return { valid: false, txid };
    if (!/^0x[a-fA-F0-9]{40}$/.test(txn.from) || !/^0x[a-fA-F0-9]{40}$/.test(txn.to)) return { valid: false, txid };
    state.pending.push(txn);
    return { valid: true, txid };
}

// Mine block (handle mints without deduction)
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

// Close issue with comment (viral ad included)
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
(window as any).processTxns = async function(): Promise<void> {
    const output = document.getElementById('output') as HTMLDivElement;
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
        state = stateData!.content;
    }

    // Fetch open issues created since lastProcessedDate with "tx" in title
    const issuesRes = await fetch(`${ISSUES_URL}?state=open&sort=created&direction=asc&per_page=100`, {
        headers: { 'Authorization': `token ${getGithubAccessToken()}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    const issues = await issuesRes.json();

    let newLastDate = state.lastProcessedDate;
    for (const issue of issues) {
        if (!issue.title.toLowerCase().startsWith('tx')) continue; // Only process issues starting with "tx"
        if (new Date(issue.created_at) <= new Date(state.lastProcessedDate)) continue; // Skip issues before lastProcessedDate
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
        const blockIndex = valid ? await mineBlock(state) : null;
        await closeIssueWithComment(issue.number, blockIndex, valid);
        if (valid) {
            output.textContent += `\nProcessed txn ${txid} from issue #${issue.number} in block ${blockIndex}`;
        } else {
            output.textContent += `\nRejected invalid txn from issue #${issue.number}`;
        }
        const success = await updateState(state, stateData!.sha, `Process issue #${issue.number}`);
        if (!success) {
            output.textContent += `\nFailed to update state after issue #${issue.number}`;
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
    output.textContent += '\nProcessing complete';
};

// View chain
(window as any).viewChain = async function(): Promise<void> {
    const output = document.getElementById('output') as HTMLDivElement;
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
};

// Auto-process every 15 seconds
window.addEventListener('load', () => {
    if (!localStorage.getItem(GITHUB_ACCESS_TOKEN_KEY)) {
        alert('Enter your GitHub access token (repo contents read/write, issues read/write) and save.');
    }
    setInterval(() => {
        (window as any).processTxns();
    }, 15000);  // 15 seconds
});
