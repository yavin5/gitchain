### Gitchain: Free chain software that runs on Github

#### What is Gitchain

A fully functional chain that runs on Github and can serve any number of clients, has a primary coin, and allows sending transactions between clients like other chains.

#### Why Use Gitchain

- Instantly Fork and Run Your Own: Easy, fast, simple to create and run a new chain. Great for research on how chains work, and to try new configurations.
- No tokens, just the primary coin: Run 1 chain per token instead
- Mint your own coins
- Network ID resolves to the fully-qualified project path on Github
- Only requires 1 web page running the Javascript code to process transactions
- Written in Typescript and Javascript, browser native

#### Technology Stack

- Typescript 5+ transpiled into Javascript
- ethereum-cryptography for cryptographic functions
- Web browser DOM and other capabilities for localStorage and secure access
- Git filesystem for data storage, including state file(s), block storage
- Github Pages web page for a UI and for running Javascript code
- Github Issues as a transaction queue for the chain
- Github API called by the Javascript code
- CDNs for a dynamic way to load common JS libraries into the web page

#### Ecosystem: Currently In Development

- Gitchain Wallet: Mobile App. The app can connect with any number of gitchains that the user wants it to connect with, and each primary coin of each gitchain shows up like tokens. The app should support swaps, and also sending transactions to other Gitchain clients.
- DEX: Pools of Gitchain coins in LP pairs. This DEX can address and access multiple Gitchains, and the DEX offers swaps. Users may input the path to their gitchain in the form of:
  1. Github base URL: by default "https://github.com/" but this is editable.
  2. Github user or organization name
  3. Github project name: by default "gitchain" but this is editable.
  and the DEX will include it and remember it. Also, farms.
- Gitscan Explorer: Shows transactions and clients in a gitchain. Drill down into the data via hyperlinks. Users input the fully-qualified path to the gitchain they would like to inspect.
- server backend process: A paid way of running the server. Docker container.

#### Context for Gitchain

Gitchain Project Context

Gitchain is a centralized chain on GitHub for storage and transaction processing. It stores chain state in the GitHub project filesystem at the location data/state.json in a GitHub repository and processes transactions submitted via GitHub Issues with titles starting with "tx" and are open issues with a body containing a transaction JSON. The frontend is a single-page web app hosted on GitHub Pages, built with TypeScript, transpiled to JavaScript, and uses CDN-loaded libraries (CryptoJS for SHA256, elliptic for secp256k1, js-sha3 for keccak256). The project is at version 0.8.0.

Key Functionality:

- State Management: The chain state (chain, pending transactions, balances, nonces, lastProcessedDate) is stored in data/state.json and accessed via GitHub’s API.
- Transaction Processing: Transactions are submitted as GitHub Issues, validated (using secp256k1 signatures), fit into blocks, and updated in the state.
- Admin Address: Defined in js/admin-address.js, used for creating tokens and any  other action that only the administrator should be able to perform.
- GitHub PAT: Users enter a GitHub Personal Access Token (PAT) with repo contents read/write permission and issues read/write permission.

Project Structure:

- index.html: The main HTML file with UI (input for GitHub PAT, buttons for saving token, viewing chain, processing transactions) and loads scripts with ?v={x} (where x is an integer that increments with each new version) for cache busting.
- js/main.js: Non-module script handling UI events (button clicks, block height display) using functions exposed on window by js/init.js.
- js/init.js: Module script importing functions from js/chain.js and exposing them on window, dispatching a gitchain:init event to signal main.js.
src/chain.ts: Core TypeScript logic for chain operations (state fetching, transaction processing, block creation, chain viewing).
- src/global.d.ts: Declares window interface for TypeScript.
- js/admin-address.js: Defines ADMIN_ADDRESS (generated via src/generate-admin-key.ts).
- vite.config.ts: Configures the vite utility for generating a web page friendly Javascript bundle of the software.
- tsconfig.json and tsconfig-esm.json: TypeScript configurations.
- package.json: Defines build scripts (npm run build compiles TypeScript and copies files to docs/js/).

Key Details:

- Chain Logic: Transactions are validated using keccak256 for hashing and secp256k1 for signature verification. Blocks are created from valid pending transactions.
- GitHub Integration: Uses GitHub API to fetch/update data/state.json and process/close issues.
- Auto-Processing: Transactions are processed periodically via setInterval in chain.ts.

<INSERT FULL src/chain.ts CODE HERE>

Notes for Modifications:

- Use TypeScript for new code in src/, compiling with npm run build (runs tsc -p tsconfig.json && tsc -p tsconfig-esm.json).
- Update index.html, js/main.js, or js/init.js as needed, incrementing ?v=7 to ?v=8 (or higher) for cache busting.
- Ensure new scripts adhere to CSP and use CDNs for external libraries.
- Transactions require valid secp256k1 signatures and must match the format in processTxns.
- Deploy changes to GitHub Pages (the / folder) and clear browser cache for testing.
