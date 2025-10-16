import { saveGithubAccessToken, viewChain, processTxns, fetchState, initP2P, getLibp2p, getServerPeers } from './chain.ts';

window.gitchain = {
    saveGithubAccessToken,
    viewChain,
    processTxns,
    fetchState,
    connectAndSendTx
};

document.addEventListener('DOMContentLoaded', async () => {
    await initP2P(localStorage.getItem('gitchain_github_access_token') !== null);
    const libp2p = getLibp2p();
    const peerIdDisplay = document.getElementById('peer-id');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-message');
    const messagesDiv = document.getElementById('messages');
    const processTxnsButton = document.getElementById('process-txns');
    const blockHeightDiv = document.getElementById('block-height');

    // Display shortened peer ID
    if (libp2p) {
        peerIdDisplay.textContent = libp2p.peerId.toString().slice(0, 8);
    }

    // Update block height
    const stateData = await fetchState();
    if (stateData) {
        blockHeightDiv.textContent = `Block Height: ${stateData.content.chain.length}`;
    }

    // Show process button if server
    const isServer = localStorage.getItem('gitchain_github_access_token') !== null;
    processTxnsButton.classList.toggle('hidden', !isServer);

    // Pubsub subscribe for messages
    if (libp2p) {
        libp2p.services.pubsub.subscribe('gitchain-chat', (evt) => {
            const message = new TextDecoder().decode(evt.detail.data);
            const senderId = evt.detail.from.toString().slice(0, 8);
            const messageElement = document.createElement('p');
            messageElement.textContent = `${senderId}: ${message}`;
            messagesDiv.appendChild(messageElement);
        });
    }

    // Send message
    sendButton.addEventListener('click', async () => {
        const message = messageInput.value.trim();
        if (message && libp2p) {
            await libp2p.services.pubsub.publish('gitchain-chat', new TextEncoder().encode(message));
            messageInput.value = '';
        }
    });

    // Save token event
    document.getElementById('save-token').addEventListener('click', async () => {
        await saveGithubAccessToken();
        processTxnsButton.classList.remove('hidden');
        document.getElementById('token-message').textContent = 'Token saved successfully';
        await initP2P(true);
        peerIdDisplay.textContent = getLibp2p().peerId.toString().slice(0, 8);
    });

    // Process transactions
    document.getElementById('process-txns').addEventListener('click', async () => {
        document.getElementById('processing-message').classList.add('visible');
        await processTxns();
        document.getElementById('processing-message').classList.remove('visible');
        const updatedState = await fetchState();
        if (updatedState) {
            blockHeightDiv.textContent = `Block Height: ${updatedState.content.chain.length}`;
        }
    });

    // View chain
    document.getElementById('view-chain').addEventListener('click', viewChain);

    // Log active servers if client
    if (!isServer) {
        const peers = getServerPeers();
        console.log('Active server peers:', peers);
    }
});
