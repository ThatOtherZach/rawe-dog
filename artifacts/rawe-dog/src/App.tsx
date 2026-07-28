import { useEffect } from "react";
import { Route, Switch, Router as WouterRouter } from "wouter";
import { Nav } from "./components/Nav";
import { AchievementToast } from "./components/AchievementToast";
// XpWidget retired — XpNavButton is now rendered inside Nav
import GeneratePage from "./pages/GeneratePage";
import LibraryPage from "./pages/LibraryPage";
import PostingsPage from "./pages/PostingsPage";
import SettingsPage from "./pages/SettingsPage";
import { checkIdleReturn } from "./lib/xpStore";

function NotFound() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-[var(--text)]">Page not found</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          <a href="/" className="text-[var(--accent)] underline">Go home</a>
        </p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={GeneratePage} />
      <Route path="/postings" component={PostingsPage} />
      <Route path="/library" component={LibraryPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    // Check for the "7 days away" achievement on load
    checkIdleReturn();
  }, []);

  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <div className="min-h-screen">
        <Nav />
        <main className="mx-auto w-full max-w-6xl px-3 pb-16 sm:px-4">
          <Router />
        </main>
        {/* XP layer — fixed, outside normal flow */}
        {/* XpNavButton is rendered inside Nav */}
        <AchievementToast />
        <footer className="mx-auto w-full max-w-6xl px-3 pb-6 pt-2 sm:px-4">
          <div className="border-t border-[var(--border)] pt-4 text-center text-xs text-[var(--muted)]">
            Resume And Work Experience - Document Output Generator
            <span className="mx-2 opacity-40">·</span>
            <a
              href="https://saymservices.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 transition hover:text-orange-300"
            >
              Designed by Saym Services inc.
            </a>
          </div>
        </footer>
      </div>
    </WouterRouter>
  );
}

export default App;
