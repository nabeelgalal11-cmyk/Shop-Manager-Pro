import { useLocation } from "wouter";

function MenuLink({ href, icon: Icon, name, isActive }: any) {
  const [, navigate] = useLocation();

  return (
    <SidebarMenuButton
      asChild
      isActive={isActive}
      tooltip={name}
      onClick={() => {
        navigate(href); // SPA navigation
        // sidebar will auto-close on outside click (mobile behavior)
      }}
    >
      <button className="flex items-center gap-3">
        <Icon className="h-4 w-4" />
        <span className="font-medium">{name}</span>
      </button>
    </SidebarMenuButton>
  );
}
