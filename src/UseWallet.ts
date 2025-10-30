import {
  walletService,
  type WalletServiceEvent,
  type WalletServiceEventData,
} from './WalletService';
import type {
  WalletDescriptor,
  ITransactionRecord,
  IAccountDescriptor,
  SimpleWallet,
} from '@kasstamp/sdk';
import { hookLogger } from './logger';

export interface WalletState {
  isConnected: boolean;
  isInitialized: boolean;
  isConnecting: boolean;
  currentNetwork: string;
  hasWallet: boolean;
  walletLocked: boolean;
  address: string | null;
  balance: string | null;
  accounts: IAccountDescriptor[];
  lastSyncTime: Date | null;
  error: string | null;
  walletName?: string | null;
}

export interface WalletActions {
  connect: (network?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  createWallet: (params: {
    walletName: string;
    walletSecret: string;
    words?: 12 | 15 | 18 | 21 | 24;
    passphrase?: string;
    network?: string;
  }) => Promise<{ wallet: SimpleWallet; mnemonic: string }>;
  importWallet: (params: {
    mnemonic: string;
    walletName: string;
    walletSecret: string;
    passphrase?: string;
    network?: string;
  }) => Promise<void>;
  openExistingWallet: (walletName: string, walletSecret: string) => Promise<void>;
  listWallets: () => Promise<WalletDescriptor[]>;
  deleteWallet: (walletName: string) => Promise<void>;
  renameWallet: (oldName: string, newName: string) => Promise<void>;
  getBalance: () => Promise<string>;
  getTransactionHistory: () => Promise<ITransactionRecord[]>;
  refreshBalance: () => Promise<void>;
}

const initialState: WalletState = {
  isConnected: false,
  isInitialized: false,
  isConnecting: false,
  currentNetwork: '',
  hasWallet: false,
  walletLocked: true,
  address: null,
  balance: null,
  accounts: [],
  lastSyncTime: null,
  error: null,
};

export function UseWallet(): [WalletState, WalletActions] {
  const finalState: WalletState = {
    //isConnecting,
  };

  return [finalState, actions];
}
