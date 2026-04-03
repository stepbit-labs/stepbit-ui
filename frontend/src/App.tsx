import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';

const Chat = lazy(() => import('./pages/Chat').then((module) => ({ default: module.Chat })));
const Database = lazy(() => import('./pages/Database').then((module) => ({ default: module.Database })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const Skills = lazy(() => import('./pages/Skills').then((module) => ({ default: module.Skills })));
const McpTools = lazy(() => import('./pages/McpTools'));
const ReasoningPlayground = lazy(() => import('./pages/ReasoningPlayground'));
const DatabaseExplorer = lazy(() => import('./pages/DatabaseExplorer'));
const Pipelines = lazy(() => import('./pages/Pipelines'));
const Workspaces = lazy(() => import('./pages/Workspaces'));


const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center bg-gruv-dark-0 text-[12px] text-gruv-light-4">
              Loading…
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="chat" element={<Chat />} />
              <Route path="database" element={<Database />} />
              <Route path="skills" element={<Skills />} />
              <Route path="mcp-tools" element={<McpTools />} />
              <Route path="reasoning" element={<ReasoningPlayground />} />
              <Route path="pipelines" element={<Pipelines />} />
              <Route path="db-explorer" element={<DatabaseExplorer />} />
              <Route path="workspaces" element={<Workspaces />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
