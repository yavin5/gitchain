// Wait for the custom init event that bundle.js dispatches
document.addEventListener('DOMContentLoaded', async () => {
  // Wait a tick for bundle.js to run.
  await new Promise(r => setTimeout(r, 300));

  // DOM elements
  const patInput          = document.getElementById('patInput');
  const savePatButton     = document.getElementById('savePat');
  const processTxnsButton = document.getElementById('processTxns');
  const viewChainButton   = document.getElementById('viewChain');
  const tokenMessage      = document.getElementById('tokenMessage');
  const blockHeight       = document.getElementById('blockHeight');
  const peerIdDisplay     = document.getElementById('peerId');
  const messageInput      = document.getElementById('message');
  const sendButton        = document.getElementById('send');

  const generateWalletBtn = document.getElementById('generateWallet');
  const restoreWalletBtn  = document.getElementById('restoreWallet');
  const walletInfoDiv     = document.getElementById('walletInfo');
  const walletStatusSpan  = document.getElementById('walletStatus');
  const mnemonicDisplay   = document.getElementById('mnemonic');
  const kaspaAddress      = document.getElementById('kaspaAddress');
  const connectPeersBtn   = document.getElementById('connectPeers');
  const chatDiv           = document.getElementById('chat');

  let signaling   = null;
  let localPeerId = '';
  const connections = new Map();

  // P2P init – shows Peer ID
  if (window.gitchain && window.gitchain.initP2P) {
    window.gitchain.initP2P().then(peerId => {
      localPeerId = peerId;
      peerIdDisplay.textContent = `Your Peer ID: ${peerId.slice(-8)}`;
    });
  }

  // Show current block height
  if (window.gitchain && window.gitchain.fetchState) {
    window.gitchain.fetchState().then(state => {
      if (state && state.content && state.content.chain) {
        blockHeight.textContent = `Block Height: ${state.content.chain.length}`;
      } else {
        blockHeight.textContent = `Block Height: 0`;
      }
    });
  }

  // PAT handling
  if (localStorage.getItem('gitchain_github_access_token')) {
    tokenMessage.textContent = 'GitHub Personal Access Token saved.';
    processTxnsButton.classList.remove('hidden');
  } else {
    processTxnsButton.classList.add('hidden');
  }

  savePatButton.addEventListener('click', () => {
    const token = patInput.value.trim();
    if (token && window.gitchain && window.gitchain.saveGithubAccessToken) {
      window.gitchain.saveGithubAccessToken(token).then(() => {
        tokenMessage.textContent = 'GitHub Personal Access Token saved.';
        processTxnsButton.classList.remove('hidden');
      }).catch(err => {
        tokenMessage.textContent = 'Error saving token: ' + err.message;
      });
    }
  });

  // Process / View chain
  processTxnsButton.addEventListener('click', () => {
    if (window.gitchain && window.gitchain.processTxns) window.gitchain.processTxns();
  });

  viewChainButton.addEventListener('click', () => {
    if (window.gitchain && window.gitchain.viewChain) window.gitchain.viewChain();
  });

  // Generate Kaspa wallet
  generateWalletBtn.addEventListener('click', () => {
    console.log("Clicked generate wallet button.");
    console.log("About to instantiate KaspaSignaling.");
    walletStatusSpan.innerHTML = `<span class="blinking">Please wait, connecting..</span>`;

    // Sleep some ticks to let chain.ts run.
    new Promise((r) => setTimeout(r, 1000)).then(async () => {

      signaling = new window.gitchain.KaspaSignaling("testnet-10", async () => {
        const walletInfoDiv = document.getElementById('walletInfo');
        console.log("walletInfoDiv: " + walletInfoDiv);
        walletStatusSpan.innerHTML = `Generating new wallet..`;

        try {
          const { mnemonic, address } = await signaling.generateWallet();
          console.log("Generated wallet: " + mnemonic + " " + address);
          mnemonicDisplay.textContent = mnemonic;
          kaspaAddress.textContent = address;
          walletInfoDiv.classList.remove("hidden");

          walletInfoDiv.innerHTML = `
            <strong>Address:</strong> ${address}<br>
            <strong>Mnemonic (keep secret):</strong><br>
            <code style="word-break:break-all;">${mnemonic}</code>
          `;
          walletStatusSpan.innerHTML = `New wallet generated!`;
        } catch (err) {
          walletInfoDiv.textContent = 'Error: ' + err.message;
        }
      });
      // Expose signaling object for other parts of the app
      window.gitchain.kaspaSignalingInstance = signaling;
    });
  });

  // Restore an existing Kaspa wallet
  restoreWalletBtn.addEventListener('click', () => {
    console.log("Clicked restore wallet button.");
    console.log("About to instantiate KaspaSignaling.");
    walletStatusSpan.innerHTML = `<span class="blinking">Please wait, connecting..</span>`;

    // Sleep some ticks to let chain.ts run.
    new Promise((r) => setTimeout(r, 1000)).then(async () => {

      signaling = new window.gitchain.KaspaSignaling("testnet-10", async () => {
        walletStatusSpan.innerHTML = `Restoring wallet..`;
        const walletAddressRestoredDiv = document.getElementById('walletAddressRestored');
        console.log("walletAddressRestoredDiv: " + walletAddressRestoredDiv);
        walletAddressRestoredDiv.classList.remove("hidden");
        const addressText = document.getElementById('addressText');
        addressText.textContent = 'Restoring…';

        try {
          console.log("signaling: " + signaling);
          await signaling.restoreWallet();
          walletStatusSpan.innerHTML = `Wallet restored!`;
        } catch (err) {
          addressText.textContent = 'Error: ' + err.message;
        }
      });

      // Expose signaling object for other parts of the app
      window.gitchain.kaspaSignalingInstance = signaling;
    });
  });

  // Connect to peers (after funding)
  connectPeersBtn.addEventListener('click', async () => {
    if (!signaling) return alert('Generate a wallet first.');

    const peers = window.gitchain.getServerPeers() || [];
    for (const peerId of peers) {
      if (peerId !== localPeerId && !connections.has(peerId)) {
        const conn = new window.gitchain.WebRTCConnection(signaling, localPeerId, peerId);
        connections.set(peerId, conn);
        console.log(`Initiated WebRTC connection to ${peerId.slice(-8)}`);
      }
    }
  });

  // Chat send
  sendButton.addEventListener('click', () => {
    const msg = messageInput.value.trim();
    if (!msg) return;

    connections.forEach(conn => conn.send(msg));

    const el = document.createElement('div');
    el.textContent = `${localPeerId.slice(-8)}: ${msg}`;
    chatDiv.appendChild(el);
    chatDiv.scrollTop = chatDiv.scrollHeight;
    messageInput.value = '';
  });
});
