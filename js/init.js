import { saveGithubAccessToken, viewChain, processTxns, fetchState } from './blockchain.js';

console.log('Imported functions:', { saveGithubAccessToken, viewChain, processTxns, fetchState });

try {
    // Expose functions to global scope for main.js
    window.saveGithubAccessToken = saveGithubAccessToken;
    window.viewChain = viewChain;
    window.processTxns = processTxns;
    window.fetchState = fetchState;
} catch (error) {
    console.error('Error setting global functions:', error);
}
