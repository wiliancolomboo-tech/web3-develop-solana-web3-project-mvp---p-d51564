use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("V1beGZ4sJ52z2x5pW5Qh7Q9zP4bN4L8Kq9ZJm8q2vibe");

#[program]
pub mod univibe_protocol {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        pool_name: [u8; 32],
        max_disbursement_ceiling: u64,
        min_voting_duration_slots: u64,
        required_vote_quorum: u64,
        initial_funding_lamports: u64,
    ) -> Result<()> {
        instructions::initialize_pool::handle_initialize_pool(
            ctx,
            pool_name,
            max_disbursement_ceiling,
            min_voting_duration_slots,
            required_vote_quorum,
            initial_funding_lamports,
        )
    }

    pub fn submit_proposal(
        ctx: Context<SubmitProposal>,
        proposal_id: u64,
        requested_amount: u64,
        ipfs_metadata_cid: [u8; 32],
    ) -> Result<()> {
        instructions::submit_proposal::handle_submit_proposal(
            ctx,
            proposal_id,
            requested_amount,
            ipfs_metadata_cid,
        )
    }

    pub fn cast_vote(
        ctx: Context<CastVote>,
        affirmative: bool,
        raw_voting_tokens: u64,
    ) -> Result<()> {
        instructions::cast_vote::handle_cast_vote(ctx, affirmative, raw_voting_tokens)
    }

    pub fn execute_milestone_payout(ctx: Context<ExecuteMilestonePayout>) -> Result<()> {
        instructions::execute_milestone_payout::handle_execute_milestone_payout(ctx)
    }
}