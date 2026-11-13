import { Github, Gitlab, GitBranch, type LucideIcon } from 'lucide-react';

// As connections-mfe draws them; lucide has no Bitbucket mark.
export const PROVIDER_ICONS: Record<string, LucideIcon> = {
  github: Github,
  gitlab: Gitlab,
  bitbucket: GitBranch,
};
