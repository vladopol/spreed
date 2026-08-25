/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { sessionStore } = vi.hoisted(() => ({ sessionStore: new Map() }))

vi.mock('../../utils/issue1777Debug.ts', () => ({
	logIssue1777: vi.fn(),
	logIssue1777Origin: vi.fn(),
}))

vi.mock('../../services/SessionStorage.js', () => ({
	default: {
		getItem: (key) => (sessionStore.has(key) ? sessionStore.get(key) : null),
		setItem: (key, value) => sessionStore.set(key, value),
		removeItem: (key) => sessionStore.delete(key),
	},
}))

/**
 * Mounts a component holding the shared composable, so that the module state is
 * initialised from SessionStorage and subscribed to the event bus.
 *
 * @param {string|null} joinedConversation token the user is already in, if any
 * @return {Promise<object>} the freshly imported module and the event bus
 */
async function setup(joinedConversation) {
	vi.resetModules()
	sessionStore.clear()
	if (joinedConversation) {
		sessionStore.set('joined_conversation', joinedConversation)
	}

	const module = await import('../useJoinedConversation.ts')
	const { EventBus } = await import('../../services/EventBus.ts')

	mount(defineComponent({
		setup() {
			module.useJoinedConversation()
			return () => h('div')
		},
	}))

	return { module, EventBus }
}

/**
 * Simulates joinConversation() completing for the given token.
 *
 * @param {object} EventBus the event bus of the imported module graph
 * @param {string} token conversation token that has been joined
 */
async function joinConversation(EventBus, token) {
	sessionStore.set('joined_conversation', token)
	EventBus.emit('joined-conversation', { token })
	await nextTick()
}

/**
 * Registers a watcher the way MainView.handleDirectCall does: the callback
 * releases the watcher through a handle assigned by the call itself.
 *
 * @param {object} module the imported composable module
 * @param {string} token target conversation token
 * @param {Function} onMatch extra work done by the callback
 * @return {Function} the callback spy
 */
function watchLikeCaller(module, token, onMatch = () => {}) {
	let unwatch
	const callback = vi.fn(() => {
		unwatch?.()
		unwatch = undefined
		onMatch()
	})
	unwatch = module.watchJoinedConversation(token, callback, { immediate: true })
	return callback
}

describe('watchJoinedConversation', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('releases itself when it fires synchronously on registration', async () => {
		// The user accepts a call in the conversation they are already viewing.
		const { module, EventBus } = await setup('room-a')

		const callback = watchLikeCaller(module, 'room-a')
		expect(callback).toHaveBeenCalledTimes(1)

		// Browsing away and back must not start another call: this is #1777.
		await joinConversation(EventBus, 'room-b')
		await joinConversation(EventBus, 'room-a')

		expect(callback).toHaveBeenCalledTimes(1)
	})

	test('still waits for the join when the conversation is not the current one', async () => {
		// The call is accepted from elsewhere - the room join is still pending.
		const { module, EventBus } = await setup('room-b')

		const callback = watchLikeCaller(module, 'room-a')
		expect(callback).not.toHaveBeenCalled()

		await joinConversation(EventBus, 'room-a')
		expect(callback).toHaveBeenCalledTimes(1)

		// And the caller's own release works on this path, as it always did.
		await joinConversation(EventBus, 'room-b')
		await joinConversation(EventBus, 'room-a')
		expect(callback).toHaveBeenCalledTimes(1)
	})

	test('leaves a non-immediate watcher alone', async () => {
		const { module, EventBus } = await setup('room-a')

		const callback = vi.fn()
		module.watchJoinedConversation('room-a', callback)
		expect(callback).not.toHaveBeenCalled()

		await joinConversation(EventBus, 'room-b')
		await joinConversation(EventBus, 'room-a')
		expect(callback).toHaveBeenCalledTimes(1)
	})
})
