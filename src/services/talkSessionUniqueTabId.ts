/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import axios from '@nextcloud/axios'
import SessionStorage from './SessionStorage.js'

const X_NEXTCLOUD_TALK_SESSION_TAB_ID = 'x-nextcloud-talk-session-tab-id'
const BASE62_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Generate a random string of base62 characters with given length (64 by default)
 *
 * @param length
 */
function generateRandomId(length = 64): string {
	const BASE62_LEN = BASE62_CHARACTERS.length // 62

	// Create an array of 32-bit unsigned integers and fill it with random values
	const randomValues = window.crypto.getRandomValues(new Uint32Array(length))

	// Build an array of random characters
	const result: string[] = new Array(length)
	for (let i = 0; i < length; i++) {
		result[i] = BASE62_CHARACTERS.charAt(randomValues[i] % BASE62_LEN)
	}

	return result.join('')
}

/**
 * Check whether the session tab id is already set. If not, generate a new one and save in the session storage.
 * Then add an axios interceptor to add this id as a header for all requests.
 *
 * Note - sessionStorage persists:
 * - on page reloads (expected to keep the same session)
 * - on tab duplication (FIXME would need to generate a new id in this case, maybe detect with BroadcastChannel API)
 */
export function setTalkSessionUniqueTabIdHeader() {
	const forceNewTabId = SessionStorage.getItem('force-new-talk-session-tab-id') === 'true'
	if (forceNewTabId) {
		// FIXME Clear SessionStorage (was duplicated from parent tab)
		SessionStorage.clear()
	}

	let tabId = SessionStorage.getItem(X_NEXTCLOUD_TALK_SESSION_TAB_ID)
	if (!tabId) {
		tabId = generateRandomId(64)
		SessionStorage.setItem(X_NEXTCLOUD_TALK_SESSION_TAB_ID, tabId)
	}

	axios.interceptors.request.use((config) => {
		// Do not clobber an explicitly set tab id. A request targeting a
		// secondary Talk session (see getBrowseSessionRequestConfig) sets its
		// own id, which must reach the server unchanged so it is mapped to a
		// separate session instead of the primary one.
		if (!config.headers[X_NEXTCLOUD_TALK_SESSION_TAB_ID]) {
			config.headers[X_NEXTCLOUD_TALK_SESSION_TAB_ID] = isBrowseSessionRequest(config)
				? getBrowseSessionTabId()
				: tabId
		}
		return config
	})
}

/**
 * Secondary, ephemeral tab id used to open a second Talk session from the same
 * tab (e.g. to browse another conversation with live updates while a call is
 * ongoing). Since https://github.com/nextcloud/spreed/pull/17230 the server
 * maps requests to distinct sessions by this id, so a different id yields a
 * second session without dropping the primary one.
 */
let browseSessionTabId: string | null = null

/**
 * Get (creating it on first use) the secondary tab id for the browse session.
 */
export function getBrowseSessionTabId(): string {
	if (!browseSessionTabId) {
		browseSessionTabId = generateRandomId(64)
	}
	return browseSessionTabId
}

/**
 * Rotate the secondary tab id, so the next browse session is a fresh one on the
 * server.
 *
 * Not used in production code on purpose: like the primary one, the secondary
 * tab id is meant to live as long as the tab does. Rotating it on every browse
 * teardown would churn server-side sessions for no benefit.
 */
export function resetBrowseSessionTabId(): void {
	browseSessionTabId = null
}

/**
 * Conversation currently browsed through the secondary Talk session, or null.
 *
 * Every request targeting this conversation must be routed to that session:
 * the primary session may hold an ongoing call in another conversation, and a
 * request arriving with the primary tab id for a conversation the primary
 * session is not in gets a 404 - which the app treats as "the session died" and
 * recovers from by re-joining, dragging the primary signaling session (and
 * therefore the call) into the browsed conversation.
 */
let browseSessionToken: string | null = null

/**
 * Mark (or unmark, with null) the conversation that is browsed through the
 * secondary Talk session.
 *
 * @param token conversation token, or null when no conversation is browsed
 */
export function setBrowseSessionToken(token: string | null): void {
	browseSessionToken = token
}

/**
 * The conversation currently browsed through the secondary Talk session.
 */
export function getBrowseSessionToken(): string | null {
	return browseSessionToken
}

/**
 * Whether a request targets the conversation currently browsed through the
 * secondary Talk session, and therefore has to be sent with the secondary tab
 * id.
 *
 * The token is either a path segment (`.../room/{token}/participants/state`,
 * `.../chat/{token}`) or a query parameter (`.../signaling/settings?token=...`),
 * so both are checked.
 *
 * @param config axios request config
 * @param config.url request url
 * @param config.params request query parameters
 */
export function isBrowseSessionRequest(config: {
	url?: string
	params?: unknown
}): boolean {
	if (!browseSessionToken) {
		return false
	}

	if (config.params && typeof config.params === 'object') {
		if (Object.values(config.params as Record<string, unknown>).includes(browseSessionToken)) {
			return true
		}
	}

	if (typeof config.url !== 'string') {
		return false
	}

	return config.url.split(/[/?&=#]/).includes(browseSessionToken)
}

/**
 * Build an axios request config that routes the request through the secondary
 * browse Talk session instead of the primary one.
 *
 * @param config additional axios request config to merge
 */
export function getBrowseSessionRequestConfig(config: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		...config,
		headers: {
			...(config.headers as Record<string, string> ?? {}),
			[X_NEXTCLOUD_TALK_SESSION_TAB_ID]: getBrowseSessionTabId(),
		},
	}
}
