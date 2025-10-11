// Extend the Window interface globally
interface Window {
    saveGithubAccessToken: () => void;
    viewChain: () => Promise<void>;
    processTxns: () => Promise<void>;
    fetchState: () => Promise<{ content: { chain: any[]; pending: any[]; balances: { [address: string]: number }; nonces: { [address: string]: number }; lastProcessedDate: string }; sha: string } | null>;
}
