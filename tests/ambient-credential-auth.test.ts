import { describe, expect, it } from "vitest";

import { ModelRegistry } from "@earendil-works/pi-coding-agent";

import { Runtime } from "../src/runtime.js";

/**
 * Regression coverage for providers that authenticate at request time.
 *
 * Amazon Bedrock with ambient AWS credentials (AWS_PROFILE / SSO) and Google
 * Vertex with ADC expose no apiKey and no auth header: pi signs each request
 * itself. Before this fix, resolveModel treated "nothing to carry" as "not
 * authenticated" and skipped every consolidation, so observational memory
 * produced no records at all on such hosts — silently, since the model was
 * never called and nothing failed.
 *
 * THE SHAPES BELOW ARE MEASURED, NOT IMAGINED. An earlier version of this file
 * modelled the ambient host as `getAuth -> undefined, hasConfiguredAuth ->
 * false`; the fix passed its tests and still skipped every consolidation on a
 * real Bedrock/SSO host. Probing pi 0.84.2's own ModelRuntime there, with
 * `AWS_PROFILE` exported, gives:
 *
 *   checkAuth("amazon-bedrock")            -> { source: "AWS_PROFILE", type: "api_key" }
 *   hasConfiguredAuth(bedrockModel)        -> true
 *   getCompatibilityRequestConfig(model)   -> { authHeader: false }
 *   getApiKeyAndHeaders(bedrockModel)      -> { ok: true, apiKey: undefined, headers: undefined }
 *
 * i.e. pi resolves a credential *source* and hands back an *empty* auth —
 * `bedrockAuth.resolve()` returns `{ auth: {}, source: "AWS_PROFILE" }`, so
 * `hasConfiguredAuth` is TRUE, not false. `googleVertexProvider`'s ADC branch
 * returns the same empty resolution. Doubles here therefore drive the REAL
 * `ModelRegistry` over a runtime that returns those measured values, so the
 * facade's own logic (not a hand-written imitation of it) is under test.
 */

/** Runtime shaped like Bedrock with AWS_PROFILE: a resolved source, empty auth. */
function ambientCredentialRegistry(): any {
	return new ModelRegistry({
		// `bedrockAuth.resolve()` / vertex ADC: a resolution with nothing to carry.
		getAuth: async () => ({ auth: {}, source: "AWS_PROFILE" }),
		getCompatibilityRequestConfig: () => ({ headers: undefined, authHeader: false }),
		// checkAuth resolved a source, so pi counts the provider as configured.
		hasConfiguredAuth: () => true,
		isUsingOAuth: () => false,
	} as any);
}

/** No credential at all: pi resolves nothing and reports the provider unconfigured. */
function unauthenticatedRegistry(): any {
	return new ModelRegistry({
		getAuth: async () => undefined,
		getCompatibilityRequestConfig: () => ({ headers: undefined, authHeader: false }),
		hasConfiguredAuth: () => false,
		isUsingOAuth: () => false,
	} as any);
}

/** Same empty-resolution shape, but the provider is OAuth — empty means expired. */
function expiredOAuthRegistry(): any {
	return new ModelRegistry({
		getAuth: async () => ({ auth: {}, source: "stored credential" }),
		getCompatibilityRequestConfig: () => ({ headers: undefined, authHeader: false }),
		hasConfiguredAuth: () => true,
		isUsingOAuth: () => true,
	} as any);
}

/** A provider pi DOES hold a credential for, which resolves to an empty key. */
function misconfiguredRegistry(): any {
	return {
		find: () => undefined,
		getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "" }),
		hasConfiguredAuth: () => true,
		isUsingOAuth: () => false,
	};
}

const bedrockModel = { provider: "amazon-bedrock", id: "eu.anthropic.claude-haiku-4-5-20251001-v1:0" };

describe("resolveModel with request-time-signed providers", () => {
	it("resolves when pi reports a credential source but hands over nothing to attach", async () => {
		const runtime = new Runtime();
		runtime.configLoaded = true;

		const registry = ambientCredentialRegistry();
		// Guard the premise: if pi's facade ever stops reporting this shape, fail here
		// rather than silently testing a fiction (the original bug in this file).
		const auth = await registry.getApiKeyAndHeaders(bedrockModel);
		expect(auth).toMatchObject({ ok: true });
		expect(auth.apiKey).toBeUndefined();
		expect(registry.hasConfiguredAuth(bedrockModel)).toBe(true);

		const result = await runtime.resolveModel({
			model: bedrockModel,
			modelRegistry: registry,
			hasUI: false,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.model).toBe(bedrockModel);
			// Nothing to forward: pi signs the request itself.
			expect(result.apiKey).toBeUndefined();
			expect(result.headers).toBeUndefined();
		}
	});

	it("still fails when pi reports no credential source for the provider", async () => {
		const runtime = new Runtime();
		runtime.configLoaded = true;

		const result = await runtime.resolveModel({
			model: bedrockModel,
			modelRegistry: unauthenticatedRegistry(),
			hasUI: false,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('no API key or auth headers for provider "amazon-bedrock"');
	});

	it("still fails for OAuth providers whose credentials no longer resolve", async () => {
		const runtime = new Runtime();
		runtime.configLoaded = true;

		const result = await runtime.resolveModel({
			model: { provider: "openai-codex", id: "gpt-5-codex" },
			modelRegistry: expiredOAuthRegistry(),
			hasUI: false,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("/login openai-codex");
	});

	it("still fails when a stored credential exists but resolves to an empty key", async () => {
		const runtime = new Runtime();
		runtime.configLoaded = true;

		const result = await runtime.resolveModel({
			model: { provider: "xai", id: "grok-4" },
			modelRegistry: misconfiguredRegistry(),
			hasUI: false,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('no API key or auth headers for provider "xai"');
	});

	it("does not accept an unconfigured provider just because auth.ok is true", async () => {
		// The blunt version of this fix (accept any ok:true with nothing to carry) let
		// every unauthenticated provider through. `hasConfiguredAuth` is what separates
		// "pi signs this itself" from "pi has nothing at all".
		const runtime = new Runtime();
		runtime.configLoaded = true;

		for (const hasConfiguredAuth of [false, undefined]) {
			const result = await runtime.resolveModel({
				model: { provider: "anthropic", id: "claude" },
				modelRegistry: {
					find: () => undefined,
					getApiKeyAndHeaders: async () => ({ ok: true }),
					hasConfiguredAuth: hasConfiguredAuth === undefined ? undefined : () => hasConfiguredAuth,
					isUsingOAuth: () => false,
				},
				hasUI: false,
			});
			expect(result.ok).toBe(false);
		}
	});
});
