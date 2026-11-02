export type Category = 'pvm' | 'skilling' | 'special';
export type Difficulty = 'standard' | 'hard' | 'elite';
export type ContractStatus = 'draft' | 'pool' | 'active' | 'retired' | 'disabled';
export type SlotState = 'active' | 'awaiting' | 'paused';
export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'closed' | 'withdrawn';
export type Role = 'player' | 'admin';

export const CATEGORIES: Category[] = ['pvm', 'skilling', 'special'];
export const DIFFICULTIES: Difficulty[] = ['standard', 'hard', 'elite'];

export const CATEGORY_LABEL: Record<Category, string> = { pvm: 'PvM', skilling: 'Skilling', special: 'Special' };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { standard: 'Standard', hard: 'Hard', elite: 'Elite' };
export const DIFFICULTY_REP: Record<Difficulty, number> = { standard: 20, hard: 30, elite: 40 };

export interface Profile {
  id: string;
  rs_name: string | null;
  role: Role;
  is_banned: boolean;
  is_muted?: boolean;
  created_at: string;
}

export interface EventSettings {
  id: boolean;
  event_name: string;
  clan_name: string;
  starts_at: string;
  ends_at: string;
  review_grace_hours: number;
  is_paused: boolean;
  slots_pvm: number;
  slots_skilling: number;
  slots_special: number;
  default_claim_limit: number;
  slots_wanted: number;
  codeword: string;
  updated_at: string;
}

export interface Rank {
  id: number;
  name: string;
  min_reputation: number;
}

export interface Contract {
  id: string;
  title: string;
  category: Category;
  difficulty: Difficulty;
  reputation: number;
  summary: string;
  description: string;
  requirements: string;
  restrictions: string;
  evidence_instructions: string;
  claim_limit: number | null;
  min_reputation: number;
  pool_order: number;
  status: ContractStatus;
  approved_count: number;
  activated_at: string | null;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SlotTier = 'main' | 'wanted';

export interface BoardSlot {
  slot_id: number;
  tier: SlotTier;
  /** Null only for an empty Most Wanted slot. */
  category: Category | null;
  slot_position: number;
  slot_state: SlotState;
  contract_id: string | null;
  title: string | null;
  summary: string | null;
  difficulty: Difficulty | null;
  reputation: number | null;
  claim_limit: number | null;
  approved_count: number | null;
  min_reputation: number | null;
  activated_at: string | null;
  claimants: string[];
  my_status: SubmissionStatus | null;
  pending_count: number | null;
  /** True before the event starts, for players: the poster's details aren't sent. */
  sealed?: boolean;
  /** Players who said "I'm hunting this" in the last 24 hours. */
  hunting_count?: number | null;
  i_am_hunting?: boolean;
}

export interface Submission {
  id: string;
  contract_id: string;
  player_id: string;
  evidence_links: string[];
  evidence_files: string[];
  player_note: string;
  status: SubmissionStatus;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface LeaderboardRow {
  place: number;
  player_id: string;
  rs_name: string;
  reputation: number;
  claims: number;
  rank_name: string | null;
}

export interface PlayerSummary {
  player_id: string;
  rs_name: string | null;
  reputation: number;
  claims: number;
  rank_name: string | null;
  next_rank_name: string | null;
  next_rank_at: number | null;
}

export interface ArchiveRow {
  contract_id: string;
  title: string;
  category: Category;
  difficulty: Difficulty;
  reputation: number;
  summary: string;
  activated_at: string | null;
  retired_at: string;
  claimants: string[];
}

export interface AuditRow {
  id: number;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ReputationEvent {
  id: number;
  player_id: string;
  amount: number;
  source: 'claim' | 'bonus' | 'adjustment';
  category: Category | null;
  contract_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface HunterProfile {
  player_id: string;
  rs_name: string;
  joined: string;
  summary: PlayerSummary | null;
  claims: { contract_id: string; title: string; category: Category; difficulty: Difficulty; reputation: number; claimed_at: string }[];
  bonus_total: number;
}

export interface IntegrationSettings {
  id: boolean;
  discord_webhook_url: string | null;
  notify_approvals: boolean;
  notify_retirements: boolean;
  notify_new_bounties: boolean;
  site_url: string | null;
  join_code: string | null;
  daily_post_hour: number | null;
  last_daily_post_on: string | null;
  final_posted: boolean;
  updated_at: string;
}

export interface ActivityRow {
  at: string;
  kind: 'claim' | 'retired' | 'posted';
  player: string | null;
  contract_id: string | null;
  title: string | null;
  reputation: number | null;
}

export interface ChatMessage {
  id: number;
  player_id: string;
  rs_name: string;
  rank_name: string | null;
  is_admin: boolean;
  body: string;
  created_at: string;
  /** emoji -> count */
  reactions?: Record<string, number>;
  my_reactions?: string[];
  pinned?: boolean;
}

export const REACTIONS = ['⚔️', '😂', '🔥', '💀', '👑', '🍺'] as const;

export interface PinnedMessage {
  id: number;
  rs_name: string;
  body: string;
  created_at: string;
  pinned_at: string;
}

export interface Achievement {
  key: string;
  label: string;
  description: string;
  times: number;
  earned_at: string | null;
}

export interface EventStats {
  podium: LeaderboardRow[];
  category_winners: Record<Category, LeaderboardRow[]>;
  claims: number;
  hunters: number;
  reputation: number;
  bounties_claimed: number;
  fastest: { contract_id: string; title: string; category: Category; seconds: number } | null;
  busiest: { contract_id: string; title: string; attempts: number } | null;
}
