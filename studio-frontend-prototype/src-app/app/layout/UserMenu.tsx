/**
 * UserMenu Component
 *
 * The signed-in identity, now in the top bar's right-hand cluster rather than at
 * the foot of the menu: the menu became a drawer that is closed most of the
 * time, and sign-out cannot live behind a hidden panel.
 *
 * A platform administrator also finds the organization requests here
 * (ADR-0051 §5): the menu is the one control that stays when they have no
 * organization in scope, or none at all.
 *
 * Profile — the person, their identities and their own connections — opens from
 * here, as the prototype's account button did: a screen no tab lists
 * (`/profile`, admin-mfe), asked for the way a tab click asks.
 */

// @cpt-dod:cpt-studiofrontend-dod-shell-levels-chain:p1
import React, { useCallback, useState } from 'react';
import {
  useFrontX,
  useAppDispatch,
  useAppSelector,
  clearUser,
  eventBus,
  useDomainExtensions,
  FRONTX_SCREEN_DOMAIN,
  type HeaderState,
} from '@gears-frontx/react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@gears-frontx/ui-kit/dropdown-menu';
import { Avatar, AvatarImage, AvatarFallback } from '@gears-frontx/ui-kit/avatar';
import { Skeleton } from '@gears-frontx/ui-kit/skeleton';
import { Building2, CircleUserRound, Inbox, LogOut, Moon, Shield, Server, Sun } from 'lucide-react';
import { useThemeChoice } from '@/app/preferences/theme';
import { resolveLevelMenu, type StudioScreenExtension } from '@/app/mfe/screenLevels';
import { useShellText } from '@/app/i18n/shellTranslations';
import { OrganizationRequestsDialog, useDecidesRequests } from './OrganizationRequests';

/** The route of the Profile screen the menu opens. */
export const PROFILE_ROUTE = '/profile';

/** First letters of the first two words of the name, or of the email. */
function initialsOf(user: { displayName?: string; email?: string } | null | undefined): string {
  const name = user?.displayName?.trim() || user?.email || '';
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?'
  );
}

export const UserMenu: React.FC = () => {
  const t = useShellText();
  const { auth } = useFrontX();
  const dispatch = useAppDispatch();
  const headerState = useAppSelector((state) => state['layout/header'] as HeaderState | undefined);
  const user = headerState?.user;
  const loading = headerState?.loading ?? false;
  const decidesRequests = useDecidesRequests();
  // The platform and Admin are offered once some screen lives there (ADR-0069).
  const screens = useDomainExtensions(FRONTX_SCREEN_DOMAIN) as StudioScreenExtension[];
  const hasPlatform = resolveLevelMenu(screens, 'platform').length > 0;
  const hasAdmin = resolveLevelMenu(screens, 'admin').length > 0;
  const profile = screens.find((screen) => screen.presentation?.route === PROFILE_ROUTE);
  // The person's theme: applied once their preferences answer, switched here.
  const [theme, chooseTheme] = useThemeChoice();
  const [requestsOpen, setRequestsOpen] = useState(false);
  const closeRequests = useCallback(() => setRequestsOpen(false), []);

  const signOut = useCallback(async () => {
    dispatch(clearUser());
    // RP-initiated logout redirects to the IdP; static-token sessions end
    // locally and the AuthGate flips to the login screen via subscribe().
    const transition = await auth?.logout();
    if (transition?.type === 'redirect') window.location.href = transition.redirectUrl;
  }, [auth, dispatch]);

  if (loading) {
    return <Skeleton className="size-8 rounded-full" />;
  }

  const label = user?.displayName || user?.email || 'User';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={label}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar>
            {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={label} />}
            <AvatarFallback>{initialsOf(user)}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-56 rounded-lg">
          <div className="px-2 py-1.5">
            <div className="truncate text-body font-medium text-foreground">{label}</div>
            {user?.displayName && user?.email && (
              <div className="truncate text-label text-muted-foreground">{user.email}</div>
            )}
          </div>
          <DropdownMenuSeparator />
          {profile && (
            <DropdownMenuItem
              onClick={() => eventBus.emit('app/context/screen/requested', { extensionId: profile.id })}
            >
              <CircleUserRound aria-hidden="true" />
              {t('user_menu_profile')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => eventBus.emit('app/context/level/requested', { level: 'organization' })}
          >
            <Building2 aria-hidden="true" />
            {t('user_menu_organization')}
          </DropdownMenuItem>
          {hasPlatform && (
            <DropdownMenuItem
              onClick={() => eventBus.emit('app/context/level/requested', { level: 'platform' })}
            >
              <Server aria-hidden="true" />
              {t('user_menu_platform')}
            </DropdownMenuItem>
          )}
          {hasAdmin && (
            <DropdownMenuItem
              onClick={() => eventBus.emit('app/context/level/requested', { level: 'admin' })}
            >
              <Shield aria-hidden="true" />
              {t('user_menu_admin')}
            </DropdownMenuItem>
          )}
          {decidesRequests && (
            <DropdownMenuItem onClick={() => setRequestsOpen(true)}>
              <Inbox aria-hidden="true" />
              {t('user_menu_organization_requests')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => chooseTheme(theme === 'dark' ? 'light' : 'dark')}
            data-theme-toggle
          >
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            {theme === 'dark' ? t('user_menu_theme_light') : t('user_menu_theme_dark')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void signOut()}>
            <LogOut aria-hidden="true" />
            {t('user_menu_sign_out')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {requestsOpen && <OrganizationRequestsDialog onClose={closeRequests} />}
    </>
  );
};

UserMenu.displayName = 'UserMenu';
