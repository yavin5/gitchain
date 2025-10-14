(function () {
    // Wait for init.js to signal that window assignments are complete
    function initialize() {
        // Access exported functions from blockchain.js (attached to window by init.js)
        const { saveGithubAccessToken, viewChain, processTxns, fetchState } = window.gitchain || {};

        // Debug: Confirm functions are loaded
        console.log('Functions exposed:', { saveGithubAccessToken, viewChain, processTxns, fetchState });

        // Update block height display
        async function updateBlockHeight() {
            const blockHeightDiv = document.getElementById('blockHeight');
            if (!blockHeightDiv) {
                console.error('blockHeight div not found');
                return;
            }
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
            if (!tokenInput || !tokenMessageDiv) {
                console.error('githubAccessToken or tokenMessage div not found');
                return;
            }
            if (tokenInput.value) {
                try {
                    saveGithubAccessToken();
                    tokenMessageDiv.textContent = 'Token saved successfully';
                    tokenMessageDiv.classList.remove('error');
                    tokenMessageDiv.classList.add('success');
                    // Clear message after 5 seconds
                    setTimeout(() => {
                        tokenMessageDiv.textContent = '';
                        tokenMessageDiv.classList.remove('success');
                    }, 5000);
                } catch (error) {
                    tokenMessageDiv.textContent = 'Failed to save token';
                    tokenMessageDiv.classList.remove('success');
                    tokenMessageDiv.classList.add('error');
                    setTimeout(() => {
                        tokenMessageDiv.textContent = '';
                        tokenMessageDiv.classList.remove('error');
                    }, 5000);
                }
            } else {
                tokenMessageDiv.textContent = 'Please enter a valid token';
                tokenMessageDiv.classList.remove('success');
                tokenMessageDiv.classList.add('error');
                setTimeout(() => {
                    tokenMessageDiv.textContent = '';
                    tokenMessageDiv.classList.remove('error');
                }, 5000);
            }
        }

        // Attach event listeners
        const savePatButton = document.getElementById('savePatButton');
        const viewChainButton = document.getElementById('viewChainButton');
        const processTxnsButton = document.getElementById('processTxnsButton');

        if (!savePatButton || !viewChainButton || !processTxnsButton) {
            console.error('One or more buttons not found');
            return;
        }

        savePatButton.addEventListener('click', () => {
            console.log('Save PAT button clicked');
            handleSaveToken();
        });

        viewChainButton.addEventListener('click', () => {
            console.log('View Chain button clicked');
            if (viewChain) {
                viewChain().catch(error => {
                    console.error('Error viewing chain:', error);
                    alert('Failed to view chain: ' + error.message);
                });
            } else {
                console.error('viewChain is not available');
                alert('View Chain function not available');
            }
        });

        processTxnsButton.addEventListener('click', () => {
            console.log('Process Transactions button clicked');
            if (processTxns) {
                processTxns().then(updateBlockHeight).catch(error => {
                    console.error('Error processing transactions:', error);
                    alert('Failed to process transactions: ' + error.message);
                });
            } else {
                console.error('processTxns is not available');
                alert('Process Transactions function not available');
            }
        });

        // Update block height on load
        updateBlockHeight();
    }

    // Listen for the custom event from init.js
    window.addEventListener('gitchain:init', () => {
        console.log('gitchain:init event received');
        initialize();
    });

    // Fallback: Check if functions are already available (in case event was missed)
    if (window.gitchain && window.gitchain.saveGithubAccessToken && window.gitchain.viewChain && window.gitchain.processTxns && window.gitchain.fetchState) {
        console.log('Functions already available, initializing immediately');
        initialize();
    } else {
        console.log('Waiting for gitchain:init event');
    }
})();
