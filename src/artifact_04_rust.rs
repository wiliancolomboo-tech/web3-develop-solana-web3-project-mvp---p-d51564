use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("UniVibe1111111111111111111111111111111111111");

#[program]
pub mod univibe_engine {
    use super::*;

    pub fn initialize_bounty(
        ctx: Context<InitializeBounty>,
        bounty_id: u64,
        title: String,
        amount: u64,
        deadline_timestamp: i64,
    ) -> Result<()> {
        instructions::initialize_bounty::handler(ctx, bounty_id, title, amount, deadline_timestamp)
    }

    pub fn submit_milestone(
        ctx: Context<SubmitMilestone>,
        deliverable_hash: [u8; 32],
    ) -> Result<()> {
        instructions::submit_milestone::handler(ctx, deliverable_hash)
    }

    pub fn approve_and_disburse(ctx: Context<ApproveAndDisburse>) -> Result<()> {
        instructions::approve_and_disburse::handler(ctx)
    }

    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        contributor_share_basis_points: u16,
    ) -> Result<()> {
        instructions::resolve_dispute::handler(ctx, contributor_share_basis_points)
    }

    pub fn claim_timeout_refund(ctx: Context<ClaimTimeoutRefund>) -> Result<()> {
        instructions::claim_timeout_refund::handler(ctx)
    }
}