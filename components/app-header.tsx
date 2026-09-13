import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemePicker } from "@/components/theme-picker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SignedInUser } from "@/lib/types";

export function AppHeader({
  user,
  signOutPath,
}: {
  user: SignedInUser;
  signOutPath: string;
}) {
  const initial = (user.displayName || user.email).trim().charAt(0).toUpperCase();
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Brand />
        <nav className="header-actions" aria-label="Account and display">
          <Link href="/" className="nav-link">
            My decks
          </Link>
          <ThemePicker />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="profile-button" aria-label="Open account menu">
                <span className="avatar-circle">{initial || <UserRound />}</span>
                <span className="profile-name">{user.displayName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="account-menu">
              <DropdownMenuLabel className="account-label">
                <span>{user.displayName}</span>
                <small>{user.email}</small>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href={signOutPath} target="_top">
                  <LogOut /> Sign out
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </div>
    </header>
  );
}
