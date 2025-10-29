// ---------------------------------------------------------------
// 1. Wait for the whole page (including <script type="module">)
// ---------------------------------------------------------------
await new Promise(r => {
  if (document.readyState === 'complete') r();
  else window.addEventListener('load', r);
});

// ---------------------------------------------------------------
// 2. Import the compiled chain code (Vite outputs bundle.js)
// ---------------------------------------------------------------
import './bundle.js';

// ---------------------------------------------------------------
// 4. Global helpers (used by chain.ts)
// ---------------------------------------------------------------
window.saveGithubAccessToken = () => {
  const token = document.getElementById('patInput').value.trim();
  if (!token) return alert('Enter a PAT first');
  localStorage.setItem('gitchain_github_access_token', token);
  alert('PAT saved – reload the page');
};

window.viewChain = async () => {
  const pre = document.getElementById('output');
  pre.textContent = 'Loading…';
  try {
    const state = await window.gitchain.fetchState();
    if (!state) throw new Error('No state');
    pre.textContent = JSON.stringify(state.content, null, 2);
  } catch (e) {
    pre.textContent = 'Error: ' + e.message;
  }
};

// ---------------------------------------------------------------
// 5. Kaspa wallet generation
// ---------------------------------------------------------------
let signalling = null;

document.getElementById('generateWallet').addEventListener('click', async () => {
  const infoDiv = document.getElementById('walletInfo');
  console.log("infoDiv: " +  infoDiv);
  infoDiv.textContent = 'Generating…';

  try {
    if (!signalling) signalling = new KaspaSignalling('testnet-10');
    await new Promise((r) => setTimeout(r, 2000));
    console.log("signalling.generateWallet()");
    const { mnemonic, address } = signalling.generateWallet();
    console.log("signalling.generateWallet() done.. " + mnemonic + " " + address);

    infoDiv.innerHTML = `
      <strong>Address:</strong> ${address}<br>
      <strong>Mnemonic (keep secret):</strong><br>
      <code style="word-break:break-all;">${mnemonic}</code>
    `;

    // expose for other parts of the app
    window.gitchain.KaspaSignallingInstance = signalling;
  } catch (err) {
    infoDiv.textContent = 'Error: ' + err.message;
  }
});

// ---------------------------------------------------------------
// 6. Dispatch the custom init event that chain.ts waits for
// ---------------------------------------------------------------
window.dispatchEvent(new Event('gitchain:init'));
