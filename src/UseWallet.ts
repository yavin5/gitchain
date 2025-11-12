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
import { KaspaSDK } from '@kasstamp/sdk';
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
  connect: (network?: string) => Promise<KaspaSDK>;
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
  let state = initialState;
  let setState: Function;
  let isConnecting = false;
  let setIsConnecting: () => boolean;

  // Helper to update state from wallet service
  const updateStateFromService = () => {
    const serviceState = walletService.getState();
    setState((prevState: WalletState) => ({
      ...prevState,
      isConnected: serviceState.isConnected,
      isInitialized: serviceState.isInitialized,
      currentNetwork: serviceState.currentNetwork.toString(),
      hasWallet: serviceState.hasWallet,
      walletLocked: serviceState.walletLocked,
      address: serviceState.address,
      balance: serviceState.balance, // Include balance from service state
      accounts: serviceState.accounts,
      walletName: serviceState.walletName,
      lastSyncTime: serviceState.lastSyncTime,
    }));
  };

  let actions: WalletActions = {
      connect: async (network?: string) => {
        let kaspaSDK: KaspaSDK | undefined;
        try {
          setIsConnecting = () => ( false );
          setState = (prevState: WalletState) => ({
            ...prevState,
            isConnecting: true,
            error: null,
          });
          kaspaSDK = await walletService.connect(network);
        } catch (error) {
          setIsConnecting = () => ( false );
          setState = (prevState: WalletState) => ({
            ...prevState,
            error: error instanceof Error ? error.message : 'Failed to connect',
            isConnecting: false,
          });
          throw error;
        }
        return kaspaSDK;
      },

      disconnect: async () => {
        try {
          await walletService.disconnect();
        } catch (error) {
          hookLogger.error('Error disconnecting:', error as Error);
          // Still reset state even if disconnect fails
          setState(initialState);
          throw error;
        }
      },

      createWallet: async (params) => {
        try {
          setState = (prevState: WalletState) => ({
            ...prevState,
            isConnecting: true,
            error: null,
          });
          const result = await walletService.createWallet(
            params.walletName,
            params.walletSecret,
            params.words,
            params.passphrase,
            params.network
          );
          updateStateFromService();
          return result;
        } catch (error) {
          setState((prevState: WalletState) => ({
            ...prevState,
            error: error instanceof Error ? error.message : 'Failed to create wallet',
          }));
          throw error;
        }
      },

      importWallet: async (params) => {
        try {
          setState((prevState: WalletState) => ({ ...prevState, error: null }));
          await walletService.importWallet(
            params.mnemonic,
            params.walletName,
            params.walletSecret,
            params.passphrase,
            params.network
          );
          updateStateFromService();
        } catch (error) {
          setState((prevState: WalletState) => ({
            ...prevState,
            error: error instanceof Error ? error.message : 'Failed to import wallet',
          }));
          throw error;
        }
      },

      openExistingWallet: async (walletName: string, walletSecret: string) => {
        try {
          setState((prevState: WalletState) => ({ ...prevState, error: null }));
          await walletService.openExistingWallet(walletName, walletSecret);
          updateStateFromService();
        } catch (error) {
          setState((prevState: WalletState) => ({
            ...prevState,
            error: error instanceof Error ? error.message : 'Failed to open wallet',
          }));
          throw error;
        }
      },

      listWallets: async () => {
        try {
          return await walletService.listWallets();
        } catch (error) {
          setState((prevState: WalletState) => ({
            ...prevState,
            error: error instanceof Error ? error.message : 'Failed to list wallets',
          }));
          throw error;
        }
      },

      deleteWallet: async (walletName: string) => {
        try {
          await walletService.deleteWallet(walletName);
        } catch (error) {
          setState((prevState: any) => ({
            ...prevState,
            error: error instanceof Error ? error.message : 'Failed to delete wallet',
          }));
          throw error;
        }
      },

      renameWallet: async (oldName: string, newName: string) => {
        try {
          await walletService.renameWallet(oldName, newName);
        } catch (error) {
          setState((prevState: WalletState) => ({
            ...prevState,
            error: error instanceof Error ? error.message : 'Failed to rename wallet',
          }));
          throw error;
        }
      },

      getBalance: async () => {
        try {
          return await walletService.getBalance();
        } catch (error) {
          setState((prevState: WalletState) => ({
            ...prevState,
            error: error instanceof Error ? error.message : 'Failed to get balance',
          }));
          throw error;
        }
      },

      getTransactionHistory: async () => {
        try {
          return await walletService.getTransactionHistory();
        } catch (error) {
          setState((prevState: WalletState) => ({
            ...prevState,
            error: error instanceof Error ? error.message : 'Failed to get transaction history',
          }));
          throw error;
        }
      },

      refreshBalance: async () => {
        try {
          const balance = await walletService.getBalance();
          setState((prevState: WalletState) => ({
            ...prevState,
            balance,
          }));
        } catch (error) {
          hookLogger.error('Error refreshing balance:', error as Error);
          setState((prevState: WalletState) => ({
            ...prevState,
            error: error instanceof Error ? error.message : 'Failed to refresh balance',
          }));
        };
      },
  };
  
  const finalState: WalletState = {
    isConnected: false,
    isInitialized: false,
    isConnecting: false,
    currentNetwork: '',
    hasWallet: false,
    walletLocked: false,
    address: null,
    balance: null,
    accounts: [],
    lastSyncTime: null,
    error: null
  };

  return [finalState, actions];
}
