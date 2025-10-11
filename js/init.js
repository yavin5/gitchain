try {
    import { saveGithubAccessToken, viewChain, processTxns, fetchState } from './blockchain.js';
    console.log('Imported functions:', { saveGithubAccessToken, viewChain, processTxns, fetchState });
    // Expose functions to global scope for main.js
    window.saveGithubAccessToken = saveGithubAccessToken;
    window.viewChain = viewChain;
    window.processTxns = processTxns;
    window.fetchState = fetchState;
} catch (error) {
    console.error('Error importing or setting global functions:', error);
}
