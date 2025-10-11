import { saveGithubAccessToken, viewChain, processTxns, fetchState } from './blockchain.js';
// Expose functions to global scope for main.js
window.saveGithubAccessToken = saveGithubAccessToken;
window.viewChain = viewChain;
window.processTxns = processTxns;
window.fetchState = fetchState;
