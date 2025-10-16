import { saveGithubAccessToken, viewChain, processTxns, fetchState, initP2P, getLibp2p, getServerPeers, connectAndSendTx } from './chain.ts';

window.gitchain = {
    saveGithubAccessToken,
    viewChain,
    processTxns,
    fetchState,
    connectAndSendTx
};

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize P2P and wait for completion
    const isServer = localStorage.getItem('gitchain_github_access_token') !== null;
    await initP2P(isServer);
    const libp2p = getLibp2p();
    const peerIdDisplay = document.getElementById('peer-id');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-message');
    const messagesDiv = document.getElementById('messages');
    const processTxnsButton = document.getElementById('process-txns');
    const blockHeightDiv = document.getElementById('block-height');

    // Display shortened peer ID
    if (libp2p && libp2p.peerId) {
        const shortPeerId = libp2p.peerId.toString().slice(0, 8);
        peerIdDisplay.textContent = shortPeerId;
        console.log('Peer ID displayed:', shortPeerId);
    } else {
        console.error('Failed to display peer ID: libp2p or peerId not available');
        peerIdDisplay.textContent = 'Error: Peer ID unavailable';
    }

    // Update block height
    const stateData = await fetchState();
    if (stateData) {
        blockHeightDiv.textContent = `Block Height: ${stateData.content.chain.length}`;
        console.log('Block height set:', stateData.content.chain.length);
    }

    // Show process button if server
    processTxnsButton.classList.toggle('hidden', !isServer);

    // Pubsub subscribe for messages
    if (libp2p && libp2p.services.pubsub) {
        try {
            await libp2p.services.pubsub.subscribe('gitchain-chat');
            console.log('Subscribed to gitchain-chat');
            libp2p.services.pubsub.addEventListener('message', (evt) => {
                if (evt.detail.topic === 'gitchain-chat') {
                    const message = new TextDecoder().decode(evt.detail.data);
                    const senderId = evt.detail.from.toString().slice(0, 8);
                    const messageElement = document.createElement('p');
                    messageElement.textContent = `${senderId}: ${message}`;
                    messagesDiv.appendChild(messageElement);
                    messagesDiv.scrollTop = messagesDiv.scrollHeight; // Auto-scroll to latest
                    console.log('Received message:', { senderId, message });
                }
            });
        } catch (error) {
            console.error('Failed to subscribe to gitchain-chat:', error);
        }
    } else {
        console.error('Pubsub service not available');
    }

    // Send message
    sendButton.addEventListener('click', async () => {
        const message = messageInput.value.trim();
        if (message && libp2p && libp2p.services.pubsub) {
            try {
                // Publish to peers
                await libp2p.services.pubsub.publish('gitchain-chat', new TextEncoder().encode(message));
                console.log('Published message:', message);
                // Append locally to ensure sender sees their own message
                const shortPeerId = libp2p.peerId.toString().slice(0, 8);
                const messageElement = document.createElement('p');
                messageElement.textContent = `${shortPeerId}: ${message}`;
                messagesDiv.appendChild(messageElement);
                messagesDiv.scrollTop = messagesDiv.scrollHeight; // Auto-scroll
                messageInput.value = '';
            } catch (error) {
                console.error('Failed to publish message:', error);
                messagesDiv.appendChild(document.createElement('p')).textContent = 'Error: Failed to send message';
            }
        } else {
            console.error('Cannot send message: libp2p or pubsub not available');
        }
    });

    // Save token event
    document.getElementById('save-token').addEventListener('click', async () => {
        await saveGithubAccessToken();
        processTxnsButton.classList.remove('hidden');
        document.getElementById('token-message').textContent = 'Token saved successfully';
        await initP2P(true);
        const newLibp2p = getLibp2p();
        if (newLibp2p && newLibp2p.peerId) {
            peerIdDisplay.textContent = newLibp2p.peerId.toString().slice(0, 8);
            console.log('Peer ID updated after PAT save:', newLibp2p.peerId.toString().slice(0, 8));
        }
    });

    // Process transactions
    document.getElementById('process-txns').addEventListener('click', async () => {
        document.getElementById('processing-message').classList.add('visible');
        await processTxns();
        document.getElementById('processing-message').classList.remove('visible');
        const updatedState = await fetchState();
        if (updatedState) {
            blockHeightDiv.textContent = `Block Height: ${updatedState.content.chain.length}`;
            console.log('Block height updated:', updatedState.content.chain.length);
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
