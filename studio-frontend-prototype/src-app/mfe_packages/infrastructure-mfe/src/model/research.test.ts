import { describe, expect, it } from 'vitest';
import type { Connection, DeployEnvironment, Deployment } from '../api/types';
import {
  RESEARCH_KIT,
  nextResearchStep,
  ownResearchSignIn,
  researchApplications,
  researchEnvironments,
  researchKitApplies,
} from './research';

const conn = (patch: Partial<Connection>): Connection => ({
  id: 'c1',
  owner_tenant_id: 'o1',
  provider: 'research',
  label: 'Constructor Research',
  account: 'ann@acme',
  base_url: 'https://research.example/api/platform-account/v1',
  scope: 'personal',
  secret_ref: '',
  created_at_epoch_secs: 0,
  ...patch,
});

const env = (patch: Partial<DeployEnvironment>): DeployEnvironment => ({
  id: 'e-r',
  name: 'research',
  description: '',
  kind: 'research',
  connection_id: 'c1',
  research_project: 'rp-1',
  registry: '',
  namespace_pattern: '{project}-{environment}',
  database: 'none',
  protected: false,
  updated_by: 'u1',
  updated_at: '2026-11-01T00:00:00Z',
  ...patch,
});

const deployment = (patch: Partial<Deployment>): Deployment => ({
  id: 'd1',
  project_id: 'p1',
  project_name: 'Shop',
  environment_id: 'e-r',
  environment_name: 'research',
  profile: 'kubernetes',
  product: 'shop',
  images: [],
  namespace: 'shop-research',
  chart_sha256: '',
  state: 'succeeded',
  requested_by: 'u1',
  requested_by_name: 'Ann',
  requested_at: '2026-11-08T10:00:00Z',
  ...patch,
});

describe('the Constructor Research kit', () => {
  it('applies only where the organization has it', () => {
    expect(researchKitApplies({ effective: [{ kit_slug: RESEARCH_KIT, version: '1' }] })).toBe(true);
    expect(researchKitApplies({ effective: [{ kit_slug: 'org-infrastructure', version: '1' }] })).toBe(false);
    expect(researchKitApplies(null)).toBe(false);
  });

  it("finds the member's own sign-in, never an organization's", () => {
    expect(ownResearchSignIn([conn({ scope: 'organization', mine: false })])).toBeNull();
    expect(ownResearchSignIn([conn({ provider: 'kubernetes' })])).toBeNull();
    expect(ownResearchSignIn([conn({ id: 'mine', scope: 'organization', mine: true })])?.id).toBe('mine');
    expect(ownResearchSignIn([conn({ id: 'personal' })])?.id).toBe('personal');
  });

  it('keeps the Research environments, by name', () => {
    const list = researchEnvironments([
      env({ id: 'b', name: 'staging' }),
      env({ id: 'k', name: 'dev', kind: 'kubernetes' }),
      env({ id: 'a', name: 'demo' }),
    ]);
    expect(list.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('lists what each project runs in each Research environment', () => {
    const envs = [env({}), env({ id: 'e-k', name: 'dev', kind: 'kubernetes' })];
    const apps = researchApplications(envs, [
      deployment({ id: 'old', requested_at: '2026-11-01T00:00:00Z' }),
      deployment({ id: 'new', state: 'failed' }),
      deployment({ id: 'k8s', environment_id: 'e-k' }),
      deployment({ id: 'other', project_id: 'p2', project_name: 'Blog' }),
    ]);
    expect([...apps.keys()]).toEqual(['e-r']);
    const shop = apps.get('e-r')!.find((a) => a.projectId === 'p1')!;
    // The newest deploy failed; the one before still runs.
    expect(shop.latest.id).toBe('new');
    expect(shop.runs?.id).toBe('old');
    expect(apps.get('e-r')!.map((a) => a.projectName)).toEqual(['Blog', 'Shop']);
  });

  it('says the next step: sign in, connect a project, deploy, then nothing', () => {
    const none = new Map();
    expect(nextResearchStep(null, [env({})], none)).toBe('sign_in');
    expect(nextResearchStep(conn({}), [env({ kind: 'kubernetes' })], none)).toBe('connect_project');
    expect(nextResearchStep(conn({}), [env({})], new Map([['e-r', []]]))).toBe('deploy');
    const running = researchApplications([env({})], [deployment({})]);
    expect(nextResearchStep(conn({}), [env({})], running)).toBe('running');
  });
});
