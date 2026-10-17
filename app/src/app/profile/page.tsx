import type { Metadata } from "next";
import ProfileApp from "../../components/profile/ProfileApp";
import "./profile.css";

export const metadata: Metadata = { title: "My Profile · AI SkillBridge" };

export default function ProfilePage() {
  return <ProfileApp />;
}
