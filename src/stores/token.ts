/**
 * SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'
import { EventBus } from '../services/EventBus.ts'

export const useTokenStore = defineStore('token', () => {
	const token = ref<'' | (string & {})>('')
	const fileIdForToken = ref<string | null>(null)
	/**
	 * The joining of a room with the signaling server always lags
	 * behind the "joining" of it in talk's UI. For this reason we
	 * might have a window of time in which we might be in
	 * conversation B in talk's UI while still leaving conversation
	 * A in the signaling server.
	 */
	const lastJoinedConversationToken = ref<'' | (string & {})>('')
	/**
	 * The conversation joined by the secondary signaling session, '' when there
	 * is none.
	 *
	 * While a call is ongoing the primary session stays pinned to the call's
	 * conversation, so another conversation the user opens is served by a second
	 * session instead. Both are "the current room" for different purposes, and
	 * this is what tells them apart app-wide.
	 */
	const browseConversationToken = ref<'' | (string & {})>('')
	/**
	 * The conversation whose call this tab has joined, '' when not in a call.
	 *
	 * Unlike `lastJoinedConversationToken`, which follows the signaling session
	 * from room to room and is reset by session recovery, this is written only
	 * when the user joins or leaves a call. Anything that has to know "a call is
	 * ongoing" - most importantly to keep the single signaling connection pinned
	 * to it - has to rely on this, so that no recovery path can silently
	 * disarm the protection by rewriting the joined conversation.
	 *
	 * Written directly (not through an action) by the participants store when a
	 * call is joined and left: calling an action of this store would rebind the
	 * active Pinia instance for whoever comes next.
	 */
	const activeCallToken = ref<'' | (string & {})>('')

	/** The viewed conversation is served by the secondary signaling session */
	const currentConversationIsBrowsed = computed(() => token.value !== '' && browseConversationToken.value === token.value)
	/** The viewed conversation is joined by the primary signaling session */
	const currentConversationIsJoinedWithCall = computed(() => token.value !== '' && lastJoinedConversationToken.value === token.value)
	/**
	 * The viewed conversation is joined, by whichever session serves it. Chat,
	 * typing and participants work in both cases; only what needs the call's
	 * own session (starting a call, WebRTC) has to look at
	 * `currentConversationIsJoinedWithCall`.
	 */
	const currentConversationIsJoined = computed(() => currentConversationIsJoinedWithCall.value || currentConversationIsBrowsed.value)

	EventBus.on('signaling-join-room', handleSignalingJoinRoom)

	onScopeDispose(() => {
		EventBus.off('signaling-join-room', handleSignalingJoinRoom)
	})

	/**
	 * Handle signaling 'joinRoom' event
	 *
	 * @param payload
	 * @param payload."0" - conversation token
	 */
	function handleSignalingJoinRoom([token]: [string]) {
		updateLastJoinedConversationToken(token)
	}

	/**
	 * @param newToken token of active conversation
	 */
	function updateToken(newToken: string) {
		token.value = newToken
	}

	/**
	 * Coupled function to update both token and file ID
	 *
	 * @param newToken token of active conversation
	 * @param newFileId file ID of active conversation
	 */
	function updateTokenAndFileIdForToken(newToken: string, newFileId: string | null) {
		token.value = newToken
		fileIdForToken.value = newFileId
	}

	/**
	 * @param newToken token of last joined conversation
	 */
	function updateLastJoinedConversationToken(newToken: string) {
		lastJoinedConversationToken.value = newToken
	}

	return {
		token,
		fileIdForToken,
		lastJoinedConversationToken,
		browseConversationToken,
		activeCallToken,
		currentConversationIsBrowsed,
		currentConversationIsJoinedWithCall,
		currentConversationIsJoined,

		updateToken,
		updateTokenAndFileIdForToken,
		updateLastJoinedConversationToken,
	}
})
