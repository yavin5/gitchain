// Ensure globals are available after blockchain.js loads
(function () {
    // Access exported functions from blockchain.js (already attached to window)
    const { saveGithubAccessToken, viewChain, processTxns } = window;

    // Debug: Confirm functions are loaded
    console.log('Functions exposed:', { saveGithubAccessToken, viewChain, processTxns });

    // Attach event listeners to buttons
    document.getElementById('saveTokenButton').addEventListener('click', saveGithubAccessToken);
    document.getElementById('viewChainButton').addEventListener('click', viewChain);
    document.getElementById('processTxnsButton').addEventListener('click', processTxns);
})();
