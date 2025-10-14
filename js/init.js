import { saveGithubAccessToken, viewChain, processTxns, fetchState } from './bundle.js';

// Debug trap to catch inline style assignments
if (window.location.hostname === 'localhost') {
    Object.defineProperty(HTMLElement.prototype, 'style', {
        set: () => console.error('Inline style set detected in init.js! Check stack trace.'),
        configurable: true
    });
}

console.log('Imported functions:', { saveGithubAccessToken, viewChain, processTxns, fetchState });
console.log('Window object before assignments:', {
    windowSaveGithubAccessToken: window.saveGithubAccessToken,
    windowViewChain: window.viewChain,
    windowProcessTxns: window.processTxns,
    windowFetchState: window.fetchState
});
try {
    // Expose functions to global scope for main.js
    window.saveGithubAccessToken = saveGithubAccessToken;
    window.viewChain = viewChain;
    window.processTxns = processTxns;
    window.fetchState = fetchState;
    console.log('Window assignments completed:', {
        windowSaveGithubAccessToken: window.saveGithubAccessToken,
        windowViewChain: window.viewChain,
        windowProcessTxns: window.processTxns,
        windowFetchState: window.fetchState
    });
    // Dispatch custom event to signal main.js
    window.dispatchEvent(new Event('gitchain:init'));
} catch (error) {
    console.error('Error setting global functions:', error);
}
// Verify assignments after try-catch
console.log('Final window assignments:', {
    windowSaveGithubAccessToken: window.saveGithubAccessToken,
    windowViewChain: window.viewChain,
    windowProcessTxns: window.processTxns,
    windowFetchState: window.fetchState
});
