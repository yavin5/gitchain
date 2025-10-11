// Extend the Window interface globally
interface Window {
    saveGithubAccessToken: () => void;
    viewChain: () => Promise<void>;
    processTxns: () => Promise<void>;
}
