// programs/anonymous-executor-anchor/src/lib-simple.rs
use anchor_lang::prelude::*;

declare_id!("gJgK3cQJA1aWARQdg5YQZ21WLztmpHDHrzKYKJF9uoz");

#[program]
pub mod anonymous_executor_anchor {
    use super::*;

    /// Initialize the executor program
    pub fn initialize(ctx: Context<Initialize>, execution_account: Pubkey) -> Result<()> {
        msg!("Initialize executor program");
        
        let executor = &mut ctx.accounts.executor;
        executor.execution_account = execution_account;
        executor.authority = ctx.accounts.authority.key();
        executor.bump = ctx.bumps.executor;
        
        msg!("Executor initialized with execution account: {}", execution_account);
        Ok(())
    }

    /// Deposit SOL to the vault
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        msg!("Deposit SOL to vault");
        
        require!(amount > 0, ErrorCode::InvalidAmount);
        
        // Transfer SOL from user to vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, amount)?;
        
        // Update user deposit balance (plaintext for now)
        let user_deposit = &mut ctx.accounts.user_deposit;
        user_deposit.user = ctx.accounts.user.key();
        user_deposit.balance = user_deposit.balance
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        
        msg!("Deposited {} lamports. New balance: {}", amount, user_deposit.balance);
        Ok(())
    }

    /// Withdraw SOL from the vault
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        msg!("Withdraw SOL from vault");
        
        let user_deposit = &mut ctx.accounts.user_deposit;
        
        require!(
            user_deposit.user == ctx.accounts.user.key(),
            ErrorCode::UnauthorizedUser
        );
        
        require!(
            user_deposit.balance >= amount,
            ErrorCode::InsufficientFunds
        );
        
        user_deposit.balance = user_deposit.balance
            .checked_sub(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        
        // Transfer SOL from vault to user
        let vault_seeds = &[b"vault".as_ref(), &[ctx.bumps.vault]];
        let signer_seeds = &[&vault_seeds[..]];
        
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            signer_seeds,
        );
        anchor_lang::system_program::transfer(transfer_ctx, amount)?;
        
        msg!("Withdrew {} lamports. New balance: {}", amount, user_deposit.balance);
        Ok(())
    }

    /// Execute transaction using user's deposit
    pub fn execute_with_intent(
          ctx: Context<ExecuteWithIntent>,
        intent_hash: [u8; 32],
        signature: [u8; 64],  
        execution_amount: u64,
    ) -> Result<()> {
        msg!("Execute with intent");
        
        require!(!signature.is_empty(), ErrorCode::InvalidSignature);
        
        let user_deposit = &mut ctx.accounts.user_deposit;
        
        require!(
            user_deposit.user == ctx.accounts.user.key(),
            ErrorCode::UnauthorizedUser
        );
        
        require!(
            user_deposit.balance >= execution_amount,
            ErrorCode::InsufficientFunds
        );
        
        user_deposit.balance = user_deposit.balance
            .checked_sub(execution_amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        
        msg!("Intent executed for user: {}", ctx.accounts.user.key());
        msg!("Intent hash: {:?}", intent_hash);
        msg!("Deducted {} lamports. New balance: {}", execution_amount, user_deposit.balance);
        
        Ok(())
    }
}

// ========== Context Structs ==========

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Executor::INIT_SPACE,
        seeds = [b"executor"],
        bump
    )]
    pub executor: Account<'info, Executor>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA
    pub vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserDeposit::INIT_SPACE,
        seeds = [b"user_deposit", user.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault"],
        bump,
    )]
    /// CHECK: Vault PDA
    pub vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"user_deposit", user.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteWithIntent<'info> {
    #[account(
        seeds = [b"executor"],
        bump = executor.bump
    )]
    pub executor: Account<'info, Executor>,
    
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA
    pub vault: SystemAccount<'info>,
    
    #[account(
        mut,
        seeds = [b"user_deposit", user.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    
    /// CHECK: User account verified through user_deposit
    pub user: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

// ========== Account Structs ==========

#[account]
#[derive(InitSpace)]
pub struct Executor {
    pub execution_account: Pubkey,
    pub authority: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserDeposit {
    pub user: Pubkey,
    pub balance: u64, // Plaintext for now (will be encrypted with INCO later)
}

// ========== Error Codes ==========

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid amount: must be greater than 0")]
    InvalidAmount,
    
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    
    #[msg("Unauthorized user")]
    UnauthorizedUser,
    
    #[msg("Insufficient funds")]
    InsufficientFunds,
    
    #[msg("Invalid signature")]
    InvalidSignature,
}