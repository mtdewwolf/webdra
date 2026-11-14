import { Shell } from './ui/Shell';
import { WorkspaceProvider } from './ui/workspace';

export function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}
