/**
 * Location: /src/core/ui/ChatUIManager.ts
 * 
 * Chat UI Manager - Handles ChatView registration, activation, and management
 * 
 * This service extracts ChatView-specific logic from PluginLifecycleManager,
 * providing a focused interface for chat UI operations.
 */

import type { App, Plugin } from 'obsidian';
import type { Settings } from '../../settings';
import type { ChatService } from '../../services/chat/ChatService';
import type { ChatOpenLocation } from '../../types/plugin/PluginTypes';
import { openOrRevealChatLeaf } from './ChatOpenLocationHelper';

/**
 * Plugin interface with optional getServiceIfReady method.
 * Avoids 'as any' cast on plugin when checking service availability.
 */
interface PluginWithServiceAccess extends Plugin {
    getServiceIfReady?<T>(name: string): T | null;
}

export interface ChatUIManagerConfig {
    plugin: PluginWithServiceAccess;
    app: App;
    settings: Settings;
    getService: <T>(name: string, timeoutMs?: number) => Promise<T | null>;
}

export class ChatUIManager {
    private config: ChatUIManagerConfig;
    private chatUIRegistered = false;
    private viewRegistered = false;

    constructor(config: ChatUIManagerConfig) {
        this.config = config;
    }

    /**
     * Register the ChatView early so Obsidian can restore it
     * This should be called during onload() BEFORE layout restoration
     * The view will show a loading state until chatService is ready
     */
    async registerViewEarly(): Promise<void> {
        if (this.viewRegistered) {
            return;
        }

        try {
            const { plugin } = this.config;

            const { ChatView, CHAT_VIEW_TYPE } = await import('../../ui/chat/ChatView');

            // Register ChatView with Obsidian - chatService may be null initially
            // ChatView handles the null case by showing a loading state
            // (its onOpen() checks this.chatService and polls if null)
            plugin.registerView(
                CHAT_VIEW_TYPE,
                (leaf) => {
                    // Try to get chatService, may be null if not ready yet
                    const chatService = this.getChatServiceSync();
                    return new ChatView(leaf, chatService as ChatService);
                }
            );

            this.viewRegistered = true;
        } catch (error) {
            console.error('Failed to register ChatView early:', error);
        }
    }

    /**
     * Synchronously get chatService if available (non-blocking)
     */
    private getChatServiceSync(): ChatService | null {
        // Access the service manager to check if chatService is ready
        // This uses the same pattern as getServiceIfReady
        const plugin = this.config.plugin;
        if (plugin.getServiceIfReady) {
            return plugin.getServiceIfReady<ChatService>('chatService');
        }
        return null;
    }

    /**
     * Register chat UI components (ribbon icon, command)
     * Call this after services are ready
     */
    async registerChatUI(): Promise<void> {
        try {
            const { plugin } = this.config;

            // Skip if already registered
            if (this.chatUIRegistered) {
                return;
            }

            // Ensure view is registered (may already be from registerViewEarly)
            await this.registerViewEarly();

            // Add ribbon icon for chat
            plugin.addRibbonIcon('message-square', 'Open chat', () => {
                void this.activateChatView();
            });

            // Add command to open chat
            plugin.addCommand({
                id: 'open-chat',
                name: 'Open chat',
                callback: () => {
                    void this.activateChatView();
                }
            });

            plugin.addCommand({
                id: 'open-chat-split-right',
                name: 'Open chat in split right',
                callback: () => {
                    void this.activateChatView('right-split');
                }
            });

            plugin.addCommand({
                id: 'open-chat-tab',
                name: 'Open chat in new tab',
                callback: () => {
                    void this.activateChatView('tab');
                }
            });

            plugin.addCommand({
                id: 'open-chat-sidebar',
                name: 'Open chat in right sidebar',
                callback: () => {
                    void this.activateChatView('right-sidebar');
                }
            });

            // Mark as registered
            this.chatUIRegistered = true;

        } catch (error) {
            console.error('Failed to register chat UI:', error);
        }
    }

    /**
     * Activate chat view in the configured or requested workspace location
     */
    async activateChatView(overrideLocation?: ChatOpenLocation): Promise<void> {
        const { app } = this.config;

        const { CHAT_VIEW_TYPE } = await import('../../ui/chat/ChatView');
        const configured = overrideLocation ?? this.config.settings?.settings?.defaultChatLayout;
        await openOrRevealChatLeaf(app, CHAT_VIEW_TYPE, configured, { relocateExisting: true });
    }

    /**
     * Check if chat UI is registered
     */
    isChatUIRegistered(): boolean {
        return this.chatUIRegistered;
    }

    /**
     * Reset registration state (useful for testing or reinitialization)
     */
    resetRegistrationState(): void {
        this.chatUIRegistered = false;
    }
}
