(function () {
    // Access exported functions from blockchain.js (attached to window by init.js)
    const { saveGithubAccessToken, viewChain, processTxns, fetchState } = window;

    // Debug: Confirm functions are loaded
    console.log('Functions exposed:', { saveGithubAccessToken, viewChain, processTxns, fetchState });

    // Update block height display
    async function updateBlockHeight() {
        const blockHeightDiv = document.getElementById('blockHeight');
        const state = await fetchState();
        if (state && state.content.chain) {
            blockHeightDiv.textContent = `Current Block Height: ${state.content.chain.length}`;
        } else {
            blockHeightDiv.textContent = 'Current Block Height: 0 (Chain not initialized)';
        }
    }

    // Wrap saveGithubAccessToken to show in-page message
    function handleSaveToken() {
        const tokenInput = document.getElementById('githubAccessToken');
        const tokenMessageDiv = document.getElementById('tokenMessage');
        if (tokenInput.value) {
            saveGithubAccessToken();
            tokenMessageDiv.textContent = 'Github personal access token saved successfully';
            tokenMessageDiv.style.color = 'green';
            // Clear message after 5 seconds
            setTimeout(() => {
                tokenMessageDiv.textContent = '';
            }, 5000);
        } else {
            tokenMessageDiv.textContent = 'Please enter a valid Github personal access token';
            tokenMessageDiv.style.color = 'red';
            setTimeout(() => {
                tokenMessageDiv.textContent = '';
            }, 5000);
        }
    }

    // Attach event listeners
    document.getElementById('saveTokenButton').addEventListener('click', handleSaveToken);
    document.getElementById('viewChainButton').addEventListener('click', viewChain);
    document.getElementById('processTxnsButton').addEventListener('click', processTxns);

    // Update block height on load and after processing transactions
    window.addEventListener('load', updateBlockHeight);
    document.getElementById('processTxnsButton').addEventListener('click', () => {
        processTxns().then(updateBlockHeight);
    });
})();
