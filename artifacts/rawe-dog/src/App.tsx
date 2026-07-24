import { Route, Switch, Router as WouterRouter } from "wouter";
import { Nav } from "./components/Nav";
import GeneratePage from "./pages/GeneratePage";
import LibraryPage from "./pages/LibraryPage";
import PostingsPage from "./pages/PostingsPage";
import SettingsPage from "./pages/SettingsPage";

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
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <div className="min-h-screen">
        <Nav />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16">
          <Router />
        </main>
      </div>
    </WouterRouter>
  );
}

export default App;
