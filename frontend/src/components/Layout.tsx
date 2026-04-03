import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
    LayoutDashboard,
    MessageSquare,
    Database,
    Settings,
    ChevronRight,
    Cpu,
    BookOpen,
    Wrench,
    Zap,
    Workflow,
    FolderTree
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ChevronLeft } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'stepbit_sidebar_collapsed';

const SidebarItem = ({
    to,
    icon: Icon,
    children,
    collapsed,
}: {
    to: string;
    icon: any;
    children: React.ReactNode;
    collapsed: boolean;
}) => (
    <NavLink
        to={to}
        aria-label={typeof children === 'string' ? children : undefined}
        title={typeof children === 'string' ? children : undefined}
        className={({ isActive }) => cn(
            "flex items-center rounded-sm transition-all duration-200 group",
            collapsed ? "justify-center px-2 py-2" : "gap-2 px-2.5 py-2",
            isActive
                ? "bg-monokai-pink text-white shadow-[0_0_8px_rgba(249,38,114,0.22)]"
                : "text-gruv-light-4 hover:bg-gruv-dark-3 hover:text-gruv-light-1"
        )}
    >
        <Icon className="w-4 h-4 shrink-0" />
        {!collapsed && (
            <>
                <span className="text-[13px] font-medium truncate">{children}</span>
                <ChevronRight className={cn(
                    "ml-auto w-3 h-3 opacity-0 transition-all duration-200",
                    "group-hover:opacity-100 group-hover:translate-x-0.5"
                )} />
            </>
        )}
    </NavLink>
);

import { useHealthCheck } from '../hooks/useHealthCheck';
import { DisconnectedOverlay } from './DisconnectedOverlay';
import { ProviderSelector } from './ProviderSelector';

export const Layout = () => {
    const { isOnline, apiConnected, dbConnected, llmosConnected, isRetrying } = useHealthCheck();
    const [sidebarCollapsed, setSidebarCollapsed] = React.useState<boolean>(() => {
        try {
            return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    });

    React.useEffect(() => {
        try {
            localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
        } catch {
            // Ignore storage failures.
        }
    }, [sidebarCollapsed]);

    return (
        <div className="flex h-screen bg-gruv-dark-1 text-gruv-light-1 overflow-hidden font-sans">
            {!isOnline && <DisconnectedOverlay isRetrying={isRetrying} />}
            {/* Sidebar */}
            <aside className={cn(
                "relative bg-gruv-dark-0 border-r border-gruv-dark-4/30 flex flex-col gap-3 transition-all duration-200 ease-out",
                sidebarCollapsed ? "w-16 p-2" : "w-56 p-3"
            )}>
                <div className={cn("flex items-center gap-2 px-0.5", sidebarCollapsed && "justify-center px-0")}>
                    <div className="w-8 h-8 bg-gradient-to-br from-monokai-pink to-monokai-purple rounded-sm flex items-center justify-center shadow-sm shrink-0">
                        <Cpu className="text-white w-4 h-4" />
                    </div>
                    {!sidebarCollapsed && (
                        <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-white to-gruv-light-4 bg-clip-text text-transparent">
                            Stepbit
                        </span>
                    )}
                </div>

                <div className={cn("px-1", sidebarCollapsed && "px-0")}>
                    <ProviderSelector collapsed={sidebarCollapsed} />
                </div>

                <nav className="flex flex-col gap-1 flex-grow">
                    <SidebarItem to="/" icon={LayoutDashboard} collapsed={sidebarCollapsed}>Dashboard</SidebarItem>
                    <SidebarItem to="/chat" icon={MessageSquare} collapsed={sidebarCollapsed}>Chat</SidebarItem>
                    <SidebarItem to="/database" icon={Database} collapsed={sidebarCollapsed}>Database</SidebarItem>
                    <SidebarItem to="/db-explorer" icon={Database} collapsed={sidebarCollapsed}>SQL Explorer</SidebarItem>
                    <SidebarItem to="/workspaces" icon={FolderTree} collapsed={sidebarCollapsed}>Workspaces</SidebarItem>
                    <SidebarItem to="/skills" icon={BookOpen} collapsed={sidebarCollapsed}>Skills</SidebarItem>
                    
                    {llmosConnected && (
                        <>
                            {!sidebarCollapsed && <div className="h-px bg-gruv-dark-4/30 my-1 mx-2.5" />}
                            <SidebarItem to="/mcp-tools" icon={Wrench} collapsed={sidebarCollapsed}>MCP Tools</SidebarItem>
                            <SidebarItem to="/reasoning" icon={Zap} collapsed={sidebarCollapsed}>Reasoning</SidebarItem>
                            <SidebarItem to="/pipelines" icon={Workflow} collapsed={sidebarCollapsed}>Pipelines</SidebarItem>
                        </>
                    )}
                    
                    <SidebarItem to="/settings" icon={Settings} collapsed={sidebarCollapsed}>Settings</SidebarItem>
                </nav>

                <div className={cn("mt-auto p-2 bg-gruv-dark-2/40 rounded-sm border border-gruv-dark-4/20 space-y-2", sidebarCollapsed && "p-1.5 space-y-1.5")}>
                    <div className={cn("flex items-center gap-2", sidebarCollapsed && "justify-center")}>
                        <div className={cn(
                            "w-1.5 h-1.5 rounded-full animate-pulse",
                            isOnline && apiConnected ? "bg-monokai-green" : "bg-monokai-red"
                        )} />
                        {!sidebarCollapsed && (
                            <span className={cn(
                                "text-[9px] font-mono uppercase tracking-wider",
                                isOnline && apiConnected ? "text-monokai-green" : "text-monokai-red"
                            )}>
                                API: {isOnline && apiConnected ? "Online" : "Offline"}
                            </span>
                        )}
                    </div>
                    <div className={cn("flex items-center gap-2", sidebarCollapsed && "justify-center")}>
                        <div className={cn(
                            "w-1.5 h-1.5 rounded-full animate-pulse",
                            isOnline && dbConnected ? "bg-monokai-aqua" : "bg-monokai-orange"
                        )} />
                        {!sidebarCollapsed && (
                            <span className={cn(
                                "text-[9px] font-mono uppercase tracking-wider",
                                isOnline && dbConnected ? "text-monokai-aqua" : "text-monokai-orange"
                            )}>
                                DB: {isOnline && dbConnected ? "Online" : "Offline"}
                            </span>
                        )}
                    </div>
                    <div className={cn("flex items-center gap-2", sidebarCollapsed && "justify-center")}>
                        <div className={cn(
                            "w-1.5 h-1.5 rounded-full animate-pulse",
                            isOnline && llmosConnected ? "bg-monokai-orange" : "bg-gruv-dark-4"
                        )} />
                        {!sidebarCollapsed && (
                            <span className={cn(
                                "text-[9px] font-mono uppercase tracking-wider",
                                isOnline && llmosConnected ? "text-monokai-orange" : "text-gruv-gray"
                            )}>
                                stepbit-core: {isOnline && llmosConnected ? "Online" : "Offline"}
                            </span>
                        )}
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => setSidebarCollapsed((current) => !current)}
                    className="absolute left-[calc(100%-10px)] top-3 z-20 w-5 h-5 rounded-sm bg-gruv-dark-2 border border-gruv-dark-4/40 text-gruv-light-4 flex items-center justify-center shadow-sm"
                    aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    <ChevronLeft className={cn("w-3 h-3 transition-transform", sidebarCollapsed && "rotate-180")} />
                </button>
            </aside>

            {/* Main Content */}
            <main className="flex-grow overflow-auto relative">
                <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-monokai-pink/5 to-transparent pointer-events-none" />
                <div className="p-4 relative z-10 w-full">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};
