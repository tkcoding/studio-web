/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FrontXProvider, apiRegistry, auth, createFrontX, microfrontends, presets, registerSlice, MfeHandlerMF, gtsPlugin, FRONTX_MFE_ENTRY_MF } from '@gears-frontx/react';
import { SHELL_SCHEMAS } from '@/app/mfe/schemas';
import {
  AccountsApiService,
  ConnectorsApiService,
  DomainModelApiService,
  STUDIO_MFE_ENTRY_IFRAME,
  StudioEventsApiService,
  StudioTasksApiService,
} from '@constructor-studio/mfe-shared';
import { IdentityApiService, OrganizationsApiService, StudioSessionApiService } from '@/app/api';
import { InstalledKitsApiService } from '@/app/api/InstalledKitsApiService';
import { PresenceApiService } from '@/app/api/PresenceApiService';
import { InboxCountApiService } from '@/app/api/InboxCountApiService';
import { ModelTypesApiService } from '@/app/api/ModelTypesApiService';
import { MfeHandlerIframe } from '@/app/mfe/MfeHandlerIframe';
import './globals.css'; // Global styles with CSS variables
import '@/app/i18n/shellTranslations'; // The shell's own strings (`shell:`)
import '@/app/events/bootstrapEvents'; // Register app-level events (type augmentation)
import { registerBootstrapEffects } from '@/app/effects/bootstrapEffects'; // Register app-level effects
import { registerAppContextEffects } from '@/app/effects/appContextEffects'; // Top-bar context slot
import { createEditorSession } from '@/app/effects/editorSessionEffects';
import { DesktopApiService } from '@/app/api/DesktopApiService';
import { registerLiveChannel } from '@/app/live/liveChannel';
import { mfeBootstrapSlice } from '@/app/slices/mfeBootstrapSlice';
import { appContextSlice } from '@/app/slices/appContextSlice';
import { appSessionSlice } from '@/app/slices/appSessionSlice';
import { editorSessionSlice } from '@/app/slices/editorSessionSlice';
import { keycloakOidcProvider } from '@/app/auth/keycloakOidcProvider';
import { sharedAuthTransport } from '@/app/auth/sharedAuthTransport';
import App from './App';
import { ShellToaster } from '@/app/layout/ShellToaster'; // Below globals.css: the kit Button's CSS must follow Tailwind's preflight

// Import all themes
import { DEFAULT_THEME_ID, defaultTheme } from '@/app/themes/default';
import { darkTheme } from '@/app/themes/dark';
import { lightTheme } from '@/app/themes/light';
import { draculaTheme } from '@/app/themes/dracula';
import { draculaLargeTheme } from '@/app/themes/dracula-large';

// Register the shell's GTS schemas before constructing the FrontX app — why each
// one has to be there is in mfe/schemas/index.ts.
for (const schema of SHELL_SCHEMAS) gtsPlugin.registerSchema(schema);
apiRegistry.register(AccountsApiService);
apiRegistry.register(IdentityApiService);
apiRegistry.register(OrganizationsApiService);
// Which kits apply to the organization in scope: a kit's tabs show only there.
apiRegistry.register(InstalledKitsApiService);
// How many items wait on the person: the top bar's Inbox button.
apiRegistry.register(InboxCountApiService);
// Which domain types are installed: a screen that needs another kit's type
// (a section's `needs`, ADR-0070 §2) shows only there.
apiRegistry.register(ModelTypesApiService);
// The backend's push channel: studio-tasks announces every background run on
// it, so a view is told instead of polling.
apiRegistry.register(StudioEventsApiService);
// The editor's session: its launch, the run that says it is ready, and the
// sources and connections it clones from.
apiRegistry.register(StudioSessionApiService);
// The desktops a project is open on, and a file handed to one (ADR-0027 §5–6).
apiRegistry.register(DesktopApiService);
apiRegistry.register(StudioTasksApiService);
apiRegistry.register(ConnectorsApiService);
// The Studio domain model: the `shows` relations a level draws as tabs (ADR-0066).
apiRegistry.register(DomainModelApiService);
// Who is in Studio now: the heartbeat, and the notes it collects (layout/Presence.tsx).
apiRegistry.register(PresenceApiService);

// Initialize API services
apiRegistry.initialize({});

// Create FrontX app instance
// Register MfeHandlerMF to enable Module Federation MFE loading
const app = createFrontX()
  .useAll(presets.full())
  .use(microfrontends({
    typeSystem: gtsPlugin,
    mfeHandlers: [
      // The handler says when there is a frame; the editor's session talks to
      // the IDE in its own (docs/feature/editor-bridge.md). Called on mount,
      // long after `editorSession` below exists.
      new MfeHandlerIframe(STUDIO_MFE_ENTRY_IFRAME, (frame, entry) => editorSession.frame(frame, entry)),
      new MfeHandlerMF(FRONTX_MFE_ENTRY_MF),
    ],
  }))
  // Bearer on every REST call of the host and, through the session it
  // publishes, of every MFE; one deduplicated refresh-and-retry after a 401.
  .use(auth({ provider: keycloakOidcProvider, transport: sharedAuthTransport() }))
  .build();

// Mock API off from the first paint: the framework's `mock()` plugin turns mock
// mode ON by default on localhost, and the MFE scaffolds still carry maps. A
// mocked `/me` is the expensive one — MFEs share the host's QueryClient, so a
// fake identity leaks into all of them and every read after it 404s against a
// tenant account-management has never heard of. The Studio panel can switch
// mocks back on.
//
// Adding a mock map: register the plugin through its service, which means a
// subclass (`BaseApiService.protocol()` is protected). Never
// `apiRegistry.plugins.add(RestProtocol, …)` — this toggle cannot reach that
// one, and it is read on every request. And key the map off the same path
// helper the client builds its URL with: `RestMockPlugin` matches the whole
// URL, query string included, which is what the deleted accounts map got
// wrong for the workspaces read.
app.actions.toggleMockMode(false);

// Register app-level slices and effects (identity flows through app.auth)
registerSlice(mfeBootstrapSlice);
registerSlice(appContextSlice);
registerSlice(appSessionSlice);
registerSlice(editorSessionSlice);
registerBootstrapEffects(app);
const editorSession = createEditorSession(app);
registerAppContextEffects(app, editorSession);
// One studio-events subscription for the signed-in person, opened by the
// Layout and relayed to the bell and to every screen that asks (app/live).
registerLiveChannel(app);

// Register all themes (default theme has default:true, activates automatically)
app.themeRegistry.register(defaultTheme);
app.themeRegistry.register(lightTheme);
app.themeRegistry.register(darkTheme);
app.themeRegistry.register(draculaTheme);
app.themeRegistry.register(draculaLargeTheme);

// Apply default theme explicitly
app.themeRegistry.apply(DEFAULT_THEME_ID);

/**
 * Render application
 * Bootstrap happens automatically when Layout mounts
 *
 * Flow:
 * 1. App renders → Layout mounts → bootstrap dispatched
 * 2. Components show skeleton loaders (translationsReady = false)
 * 3. User fetched → language set → translations loaded
 * 4. Components re-render with actual text (translationsReady = true)
 * 5. MFE system loads and mounts extensions via MfeScreenContainer
 *
 * Note: Mock API is controlled via the FrontX Studio panel.
 * The mock plugin (included in full preset) handles mock plugin lifecycle automatically.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FrontXProvider app={app}>
      <App />
      <ShellToaster />
    </FrontXProvider>
  </StrictMode>
);
