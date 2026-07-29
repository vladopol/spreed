/**
 * SPDX-FileCopyrightText: 2024 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {
	Conversation,
	SignalingSessionPayload,
	StandaloneSignalingLeaveSession,
	StandaloneSignalingUpdateSession,
} from '../types/index.ts'

import { createSharedComposable } from '@vueuse/core'
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { useStore } from 'vuex'
import { CONVERSATION } from '../constants.ts'
import { EventBus } from '../services/EventBus.ts'
import { useActorStore } from '../stores/actor.ts'
import { useSessionStore } from '../stores/session.ts'
import { isChannelConversation } from '../utils/conversation.ts'
import { useDocumentVisibility } from './useDocumentVisibility.ts'
import { useGetToken } from './useGetToken.ts'
import { useIsInCall } from './useIsInCall.js'

let fetchingParticipants = false
let pendingChanges = true
let throttleFastUpdateTimeout: ReturnType<typeof setTimeout> | undefined
let throttleSlowUpdateTimeout: ReturnType<typeof setTimeout> | undefined
let throttleLongUpdateTimeout: ReturnType<typeof setTimeout> | undefined

/**
 * Composable to control logic for fetching participants list
 *
 * @param activeTab current active tab
 */
function useGetParticipantsComposable(activeTab = ref('participants')) {
	const actorStore = useActorStore()
	const sessionStore = useSessionStore()
	const store = useStore()
	const isInCall = useIsInCall()
	const isDocumentVisible = useDocumentVisibility()

	const isActive = computed(() => activeTab.value === 'participants')
	const token = useGetToken()
	const conversation = computed<Conversation | undefined>(() => store.getters.conversation(token.value))
	const isInLobby = computed<boolean>(() => store.getters.isInLobby)
	const isModeratorOrUser = computed<boolean>(() => store.getters.isModeratorOrUser)
	const isOneToOneConversation = computed(() => conversation.value?.type === CONVERSATION.TYPE.ONE_TO_ONE
		|| conversation.value?.type === CONVERSATION.TYPE.ONE_TO_ONE_FORMER)

	/**
	 * Initialise the get participants listeners
	 *
	 */
	function initialiseGetParticipants() {
		EventBus.on('joined-conversation', onJoinedConversation)
		EventBus.on('signaling-users-in-room', handleUsersUpdated)
		EventBus.on('signaling-users-joined', handleUsersUpdated)
		EventBus.on('signaling-users-changed', handleUsersUpdated)
		EventBus.on('signaling-users-left', handleUsersLeft)
		EventBus.on('signaling-all-users-changed-in-call-to-disconnected', handleUsersDisconnected)
		EventBus.on('signaling-participant-list-updated', handleParticipantListChanged)
		EventBus.on('signaling-users-changed', checkCurrentUserPermissions)
	}

	/**
	 * Patch participants list from signaling messages (joined/changed)
	 *
	 * @param payload
	 * @param payload."0" - users list
	 * @param payload."1" - conversation the message came for
	 */
	function handleUsersUpdated([users, roomToken]: [SignalingSessionPayload[], string]) {
		if (!roomToken) {
			return
		}

		const sessionsChanged = sessionStore.updateSessions(roomToken, users)

		if (roomToken !== token.value) {
			// A conversation that is not the viewed one - the call's, while
			// another conversation is being browsed. Its sessions are kept up to
			// date, but it must not trigger a refetch of the viewed one.
			return
		}

		if (sessionsChanged) {
			throttleUpdateParticipants()
		} else {
			throttleLongUpdate()
		}
	}

	/**
	 * Check if current user permission has been changed from signaling messages
	 *
	 * @param payload
	 * @param payload."0" - users list
	 * @param payload."1" - conversation the message came for
	 */
	async function checkCurrentUserPermissions([users, roomToken]: [StandaloneSignalingUpdateSession[], string]) {
		if (!roomToken || roomToken !== token.value || !conversation.value) {
			// No conversation to associate the message with, or it came for
			// another one than the viewed one (the call's, while this one is
			// being browsed) - its permissions are re-read when it is opened.
			return
		}

		// TODO: move logic to sessionStore
		const currentUser = users.find((user) => {
			return user.userId ? user.userId === actorStore.userId : user.actorId === actorStore.actorId
		})
		if (!currentUser) {
			return
		}
		// refresh conversation, if current user permissions have been changed
		if (currentUser.participantPermissions !== conversation.value.permissions) {
			await store.dispatch('fetchConversation', { token: token.value })
		}

		const currentParticipant = store.getters.getParticipant(token.value, actorStore.attendeeId)
		if (currentParticipant && isModeratorOrUser.value && currentUser.participantPermissions !== currentParticipant.permissions) {
			await cancelableGetParticipants()
		}
	}

	/**
	 * Patch participants list from signaling messages (left)
	 *
	 * @param payload
	 * @param payload."0" - users list
	 * @param payload."1" - conversation the message came for
	 */
	function handleUsersLeft([sessionIds, roomToken]: [StandaloneSignalingLeaveSession[], string]) {
		if (!roomToken) {
			return
		}

		sessionStore.updateSessionsLeft(roomToken, sessionIds)

		if (roomToken === token.value) {
			throttleLongUpdate()
		}
	}

	/**
	 * Patch participants list from signaling messages (end call for everyone)
	 *
	 * @param payload
	 * @param payload."0" - conversation the message came for
	 */
	function handleUsersDisconnected([roomToken]: [string]) {
		if (!roomToken) {
			return
		}

		sessionStore.updateParticipantsDisconnectedFromStandaloneSignaling(roomToken)

		if (roomToken === token.value) {
			throttleLongUpdate()
		}
	}

	/**
	 * Refresh the participants list of the viewed conversation, if the signaling
	 * message came for it.
	 *
	 * @param payload
	 * @param payload."0" - conversation the message came for
	 */
	function handleParticipantListChanged([roomToken]: [string]) {
		if (roomToken === token.value) {
			throttleUpdateParticipants()
		}
	}

	/**
	 * Stop the get participants listeners
	 *
	 */
	function stopGetParticipants() {
		EventBus.off('joined-conversation', onJoinedConversation)
		EventBus.off('signaling-users-in-room', handleUsersUpdated)
		EventBus.off('signaling-users-joined', handleUsersUpdated)
		EventBus.off('signaling-users-changed', handleUsersUpdated)
		EventBus.off('signaling-users-left', handleUsersLeft)
		EventBus.off('signaling-all-users-changed-in-call-to-disconnected', handleUsersDisconnected)
		EventBus.off('signaling-participant-list-updated', handleParticipantListChanged)
		EventBus.off('signaling-participant-list-changed', handleParticipantListChanged)
		EventBus.off('signaling-users-changed', checkCurrentUserPermissions)
	}

	/**
	 * Trigger participants list update upon joining
	 */
	async function onJoinedConversation() {
		cancelableGetParticipants()
	}

	/**
	 * Schedule a participants list update depending on conditions:
	 * - participant list is visible - fast update
	 * - chat is open, tab is in background, user is not in the current call - slow update
	 */
	function throttleUpdateParticipants() {
		if (!isActive.value && !isInCall.value) {
			// Update is ignored but there is a flag to force the participants update
			pendingChanges = true
			return
		}

		if (isDocumentVisible.value && (isInCall.value || !conversation.value?.hasCall)) {
			throttleFastUpdate()
		} else {
			throttleSlowUpdate()
		}
		pendingChanges = false
	}

	/**
	 * Update participants list
	 */
	async function cancelableGetParticipants() {
		if (fetchingParticipants || token.value === '' || isInLobby.value || !isModeratorOrUser.value
			|| (isChannelConversation(conversation.value) && !store.getters.isModerator)) {
			return
		}

		fetchingParticipants = true
		cancelPendingUpdates()

		await store.dispatch('fetchParticipants', { token: token.value })
		fetchingParticipants = false
	}

	/**
	 * Schedule a participants list update (in 3 seconds)
	 */
	function throttleFastUpdate() {
		if (!fetchingParticipants && !throttleFastUpdateTimeout) {
			throttleFastUpdateTimeout = setTimeout(cancelableGetParticipants, 3_000)
		}
	}

	/**
	 * Schedule a participants list update (in 15 seconds)
	 */
	function throttleSlowUpdate() {
		if (!fetchingParticipants && !throttleSlowUpdateTimeout) {
			throttleSlowUpdateTimeout = setTimeout(cancelableGetParticipants, 15_000)
		}
	}

	/**
	 * Schedule a participants list update (in 60 seconds)
	 */
	function throttleLongUpdate() {
		if (!fetchingParticipants && !throttleLongUpdateTimeout) {
			throttleLongUpdateTimeout = setTimeout(cancelableGetParticipants, 60_000)
		}
	}

	initialiseGetParticipants()

	watch(token, () => {
		cancelPendingUpdates()
	})

	watch(isActive, (newValue) => {
		if (newValue && pendingChanges) {
			throttleUpdateParticipants()
		}
	})

	watch(isModeratorOrUser, (newValue, oldValue) => {
		if (newValue && !oldValue) {
			// Fetch participants list if guest was promoted to moderators
			nextTick(() => throttleUpdateParticipants())
		}
	})

	onScopeDispose(() => {
		cancelPendingUpdates()
		stopGetParticipants()
	})

	/**
	 * Cancel scheduled participant list updates
	 * Applies to all parallel queues to not fetch twice
	 */
	function cancelPendingUpdates() {
		clearTimeout(throttleFastUpdateTimeout)
		throttleFastUpdateTimeout = undefined
		clearTimeout(throttleSlowUpdateTimeout)
		throttleSlowUpdateTimeout = undefined
		clearTimeout(throttleLongUpdateTimeout)
		throttleLongUpdateTimeout = undefined
	}

	return {
		cancelableGetParticipants,
	}
}

/**
 * Shared composable to control logic for fetching participants list
 */
export const useGetParticipants = createSharedComposable(useGetParticipantsComposable)
