/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, test } from 'vitest'
import {
	getBrowseSessionRequestConfig,
	getBrowseSessionTabId,
	getBrowseSessionToken,
	isBrowseSessionRequest,
	resetBrowseSessionTabId,
	setBrowseSessionToken,
} from './talkSessionUniqueTabId.ts'

const HEADER = 'x-nextcloud-talk-session-tab-id'
const BROWSED = 'browsed01'
const CALL = 'call00042'

describe('talkSessionUniqueTabId - browse session', () => {
	afterEach(() => {
		resetBrowseSessionTabId()
	})

	test('generates a stable browse tab id across calls', () => {
		const first = getBrowseSessionTabId()
		const second = getBrowseSessionTabId()
		expect(first).toBe(second)
		expect(first).toHaveLength(64)
	})

	test('rotates the browse tab id on reset', () => {
		const before = getBrowseSessionTabId()
		resetBrowseSessionTabId()
		const after = getBrowseSessionTabId()
		expect(after).not.toBe(before)
	})

	test('request config carries the browse tab id header', () => {
		const config = getBrowseSessionRequestConfig()
		expect((config.headers as Record<string, string>)[HEADER]).toBe(getBrowseSessionTabId())
	})

	test('request config merges provided config and headers', () => {
		const config = getBrowseSessionRequestConfig({
			params: { token: 'abc' },
			headers: { 'X-Custom': '1' },
		})
		expect(config.params).toEqual({ token: 'abc' })
		expect((config.headers as Record<string, string>)['X-Custom']).toBe('1')
		expect((config.headers as Record<string, string>)[HEADER]).toBe(getBrowseSessionTabId())
	})
})

describe('talkSessionUniqueTabId - routing requests by conversation', () => {
	afterEach(() => {
		setBrowseSessionToken(null)
	})

	test('no conversation is browsed by default', () => {
		expect(getBrowseSessionToken()).toBeNull()
		expect(isBrowseSessionRequest({ url: `/ocs/v2.php/apps/spreed/api/v4/room/${BROWSED}/participants/state` })).toBe(false)
	})

	test('routes requests targeting the browsed conversation by path segment', () => {
		setBrowseSessionToken(BROWSED)

		// The very request that broke the call in production: on window
		// visibility changes the app marks the *viewed* conversation's session
		// inactive, which must reach the secondary session.
		expect(isBrowseSessionRequest({ url: `/ocs/v2.php/apps/spreed/api/v4/room/${BROWSED}/participants/state` })).toBe(true)
		expect(isBrowseSessionRequest({ url: `/ocs/v2.php/apps/spreed/api/v1/chat/${BROWSED}` })).toBe(true)
		expect(isBrowseSessionRequest({ url: `/ocs/v2.php/apps/spreed/api/v1/chat/${BROWSED}/read` })).toBe(true)
		expect(isBrowseSessionRequest({ url: `/ocs/v2.php/apps/spreed/api/v1/reaction/${BROWSED}/1234` })).toBe(true)
	})

	test('routes requests targeting the browsed conversation by query parameter', () => {
		setBrowseSessionToken(BROWSED)

		expect(isBrowseSessionRequest({
			url: '/ocs/v2.php/apps/spreed/api/v3/signaling/settings',
			params: { token: BROWSED },
		})).toBe(true)
	})

	test('leaves requests for any other conversation on the primary session', () => {
		setBrowseSessionToken(BROWSED)

		// Notably the call itself: hanging up must not go through the
		// secondary session.
		expect(isBrowseSessionRequest({ url: `/ocs/v2.php/apps/spreed/api/v4/call/${CALL}` })).toBe(false)
		expect(isBrowseSessionRequest({ url: `/ocs/v2.php/apps/spreed/api/v4/room/${CALL}/participants/state` })).toBe(false)
		expect(isBrowseSessionRequest({
			url: '/ocs/v2.php/apps/spreed/api/v3/signaling/settings',
			params: { token: CALL },
		})).toBe(false)
		expect(isBrowseSessionRequest({ url: '/ocs/v2.php/apps/spreed/api/v4/room' })).toBe(false)
	})

	test('does not match a token that is only a substring of a path segment', () => {
		setBrowseSessionToken(BROWSED)

		expect(isBrowseSessionRequest({ url: `/ocs/v2.php/apps/spreed/api/v4/room/${BROWSED}x/participants/state` })).toBe(false)
		expect(isBrowseSessionRequest({ url: `/ocs/v2.php/apps/spreed/api/v4/room/x${BROWSED}` })).toBe(false)
	})

	test('handles requests without a url or params', () => {
		setBrowseSessionToken(BROWSED)

		expect(isBrowseSessionRequest({})).toBe(false)
		expect(isBrowseSessionRequest({ params: undefined })).toBe(false)
	})
})
