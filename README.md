### Gitchain: Free blockchain software that runs on Github

#### What is Gitchain

A fully functional cryptocurrency blockchain that runs on top of Github and can serve any number of wallets, has a primary cryptocoin, and allows sending transactions between wallets like other cryptocurrency blockchains. Originally written by Yavin5.

#### Why Use Gitchain

- Github is the Server
- Instantly Fork and Run Your Own: Easy and fast to create and run a new blockchain
- Mint your own coins
- No tokens, just the primary coin: Run 1 blockchain per token instead
- Network ID is the fully-qualified project path on Github
- Transaction fee: zero if there's no paid server. Small otherwise.
- Only requires 1 browser running the web page to process transactions
- Written in Typescript and Javascript, browser native

#### Technology Stack

- Github git filesystem for data storage, including block storage
- Github Pages web page for a UI and for running Javascript server code
- Github Issues as a blockchain transaction queue
- Github API called by the Javascript to make use of server capabilities
- CDNs for a dynamic way to load common JS libraries from the web page
- Typescript 5+ transpiled into Javascript
- ethereum-cryptography for cryptographic functions
- Web browser DOM and other capabilities for localStorage and secure access

#### Ecosystem: Currently In Development

- Gitchain Wallet: Mobile Wallet App. The app can connect with any number of gitchains that the user wants it to connect with, and each primary coin of each gitchain shows up like tokens in a Solana or Ethereum wallet. The wallet should support swaps using Gitswap DEX, and also sending transactions to other Gitchain wallets.
- Gitswap DEX: Liquidity pools of Gitchain coins in trading pairs. This DEX can address and access multiple Gitchains, and the DEX offers trading. Users may input the path to their gitchain in the form of:
  1. Github base URL: by default "https://github.com/" but this is editable.
  2. Github user or organization name: Example: yavin5
  3. Github project name: by default "gitchain" but this is editable.
  and Gitswap will include it and remember it. Also, yield farms.
- Gitscan Block Explorer: Shows transactions and wallets in a gitchain. Drill down into the data via hyperlinks. Users input the fully-qualified path to the gitchain they would like to inspect.
- a web wallet for gitchain: Hosted on Github, using a software key stored in localStorage, or a key from a hardware wallet
- server backend process: A paid way of running the server. Docker container.

#### Context for Gitchain

Gitchain Project Context

Gitchain is a centralized blockchain using GitHub for storage and transaction processing. It stores blockchain state in the GitHub project filesystem at the location data/state.json in a GitHub repository (the original is yavin5/gitchain) and processes transactions submitted via GitHub Issues with titles starting with "tx" and are open issues with a body containing a transaction JSON. The frontend is a single-page web app hosted on GitHub Pages (https://yavin5.github.io/gitchain/), built with TypeScript, compiled to JavaScript, and uses CDN-loaded libraries (CryptoJS for SHA256, elliptic for secp256k1, js-sha3 for keccak256). The project is at version 0.8.0.

Key Functionality:

- State Management: The blockchain state (chain, pending transactions, balances, nonces, lastProcessedDate) is stored in data/state.json and accessed via GitHub’s API.
- Transaction Processing: Transactions are submitted as GitHub Issues, validated (using secp256k1 signatures), mined into blocks, and updated in the state.
- Admin Address: Defined in js/admin-address.js, used for minting tokens and any  other action that only the administrator should be able to perform.
- GitHub PAT: Users enter a GitHub Personal Access Token (PAT) with repo contents read/write permission and issues read/write permission, stored in localStorage.

Project Structure:

- index.html: The main HTML file with UI (input for GitHub PAT, buttons for saving token, viewing chain, processing transactions) and loads scripts with ?v=7 for cache busting.
- js/main.js: Non-module script handling UI events (button clicks, block height display) using functions exposed on window by js/init.js.
- js/init.js: Module script importing functions from js/blockchain.js and exposing them on window, dispatching a gitchain:init event to signal main.js.
src/blockchain.ts: Core TypeScript logic for blockchain operations (state fetching, transaction processing, block mining, chain viewing).
- src/global.d.ts: Declares window interface for TypeScript.
- js/admin-address.js: Defines ADMIN_ADDRESS (generated via src/generate-admin-key.ts).
- tsconfig.json and tsconfig-esm.json: TypeScript configurations for CommonJS and ES modules.
- package.json: Defines build scripts (npm run build compiles TypeScript and copies files to docs/js/).

Key Details:

- Blockchain Logic: Transactions are validated using keccak256 for hashing and secp256k1 for signature verification. Blocks are mined from valid pending transactions.
- GitHub Integration: Uses GitHub API to fetch/update data/state.json and process/close issues. Conflicts are handled with retries.
- Security: Content Security Policy (CSP) allows scripts from self and CDNs, with connect-src for GitHub API.
- Auto-Processing: Transactions are processed every 15 seconds via setInterval in blockchain.ts.

<INSERT FULL src/blockchain.ts CODE HERE>

Notes for Modifications:

- Use TypeScript for new code in src/, compiling with npm run build (runs tsc -p tsconfig.json && tsc -p tsconfig-esm.json).
- Update index.html, js/main.js, or js/init.js as needed, incrementing ?v=7 to ?v=8 (or higher) for cache busting.
- Ensure new scripts adhere to CSP and use CDNs for external libraries.
- Transactions require valid secp256k1 signatures and must match the format in processTxns.
- Deploy changes to GitHub Pages (yavin5/gitchain, / folder) and clear browser cache for testing.
