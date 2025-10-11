(function () {
    // Wait for init.js to signal that window assignments are complete
    function initialize() {
        // Access exported functions from blockchain.js (attached to window by init.js)
        const { saveGithubAccessToken, viewChain, processTxns, fetchState } = window;

        // Debug: Confirm functions are loaded
        console.log('Functions exposed:', { saveGithubAccessToken, viewChain, processTxns, fetchState });

        // Update block height display
        async function updateBlockHeight() {
            const blockHeightDiv = document.getElementById('blockHeight');
            if (!fetchState) {
                blockHeightDiv.textContent = 'Current Block Height: Error (fetchState not available)';
                console.error('fetchState is not available');
                return;
            }
            try {
                const state = await fetchState();
                if (state && state.content.chain) {
                    blockHeightDiv.textContent = `Current Block Height: ${state.content.chain.length}`;
                } else {
                    blockHeightDiv.textContent = 'Current Block Height: 0 (Chain not initialized)';
                }
            } catch (error) {
                blockHeightDiv.textContent = 'Current Block Height: Error fetching state';
                console.error('Error fetching state:', error);
            }
        }

        // Wrap saveGithubAccessToken to show in-page message
        function handleSaveToken() {
            const tokenInput = document.getElementById('githubAccessToken');
            const tokenMessageDiv = document.getElementById('tokenMessage');
            if (tokenInput.value) {
                try {
                    saveGithubAccessToken();
                    tokenMessageDiv.textContent = 'Token saved successfully';
                    tokenMessageDiv.style.color = 'green';
                    // Clear message after 5 seconds
                    setTimeout(() => {
                        tokenMessageDiv.textContent = '';
                    }, 5000);
                } catch (error) {
                    tokenMessageDiv.textContent = 'Failed to save token';
                    tokenMessageDiv.style.color = 'red';
                    setTimeout(() => {
                        tokenMessageDiv.textContent = '';
                    }, 5000);
                }
            } else {
                tokenMessageDiv.textContent = 'Please enter a valid token';
                tokenMessageDiv.style.color = 'red';
                setTimeout(() => {
                    tokenMessageDiv.textContent = '';
                }, 5000);
            }
        }

        // Attach event listeners
        document.getElementById('saveTokenButton').addEventListener('click', handleSaveToken);
        document.getElementById('viewChainButton').addEventListener('click', () => {
            if (viewChain) viewChain();
            else console.error('viewChain is not available');
        });
        document.getElementById('processTxnsButton').addEventListener('click', () => {
            if (processTxns) processTxns().then(updateBlockHeight);
            else console.error('processTxns is not available');
        });

        // Update block height on load and after processing transactions
        updateBlockHeight();
    }

    // Listen for the custom event from init.js
    window.addEventListener('gitchain:init', () => {
        console.log('gitchain:init event received');
        initialize();
    });

    // Fallback: Check if functions are already available (in case event was missed)
    if (window.saveGithubAccessToken && window.viewChain && window.processTxns && window.fetchState) {
        console.log('Functions already available, initializing immediately');
        initialize();
    } else {
        console.log('Waiting for gitchain:init event');
    }
})();
