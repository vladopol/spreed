/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { MaybeRefOrGetter, WatchCallback, WatchOptions, WatchStopHandle } from 'vue'

import { createSharedComposable } from '@vueuse/core'
import { onBeforeMount, onBeforeUnmount, readonly, ref, toValue, watch } from 'vue'
import { EventBus } from '../services/EventBus.ts'
import SessionStorage from '../services/SessionStorage.js'
import { logIssue1777 } from '../utils/issue1777Debug.ts'

const joinedConversationToken = ref<string | null>(null)

/**
 * Update ref from SessionStorage
 */
function readJoinedConversation() {
	const previous = joinedConversationToken.value
	joinedConversationToken.value = SessionStorage.getItem('joined_conversation')
	logIssue1777('readJoinedConversation', { previous, next: joinedConversationToken.value })
}

/**
 * Shared composable exposing the currently joined conversation token.
 */
function useJoinedConversationComposable() {
	onBeforeMount(() => {
		EventBus.on('joined-conversation', readJoinedConversation)
		readJoinedConversation()
		logIssue1777('useJoinedConversation mounted', { sessionStorageValueOnMount: SessionStorage.getItem('joined_conversation') })
	})

	onBeforeUnmount(() => {
		EventBus.off('joined-conversation', readJoinedConversation)
	})

	return readonly(joinedConversationToken)
}

export const useJoinedConversation = createSharedComposable(useJoinedConversationComposable)

/**
 * Watch for the current joined conversation matching the provided token.
 *
 * @param token token to match against the joined conversation
 * @param callback callback triggered when the joined conversation matches the token
 * @param options watch options
 */
export function watchJoinedConversation(
	token: MaybeRefOrGetter<string | null>,
	callback: WatchCallback<string, string | null | undefined>,
	options?: WatchOptions,
): WatchStopHandle {
	const currentJoinedConversation = useJoinedConversation()
	let fired = false

	logIssue1777('watchJoinedConversation registered', {
		targetToken: toValue(token),
		currentValueAtSetup: currentJoinedConversation.value,
		immediate: options?.immediate,
		willFireImmediatelyDueToStaleMatch: Boolean(options?.immediate) && currentJoinedConversation.value === toValue(token),
	}, true)

	const stop = watch(currentJoinedConversation, (newToken, oldToken, onCleanup) => {
		const targetToken = toValue(token)
		const matched = Boolean(targetToken) && newToken === targetToken
		logIssue1777('watchJoinedConversation fired', { newToken, oldToken, targetToken, matched })
		if (!targetToken || newToken !== targetToken) {
			return
		}

		logIssue1777('watchJoinedConversation MATCHED, invoking callback (triggers joinCall)', { newToken, targetToken }, true)
		fired = true
		callback(newToken, oldToken, onCleanup)
	}, options)

	// With `immediate: true` and an already-matching value, the callback above ran
	// synchronously - before `stop` existed, so a caller that releases the watcher
	// from its own callback released `undefined` and the watcher stayed alive for
	// the rest of the session (nextcloud/talk-desktop#1777). Release it here.
	if (fired) {
		logIssue1777('watchJoinedConversation released after synchronous immediate firing', {
			targetToken: toValue(token),
		}, true)
		stop()
	}

	return stop
}
