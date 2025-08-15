import {
  BigInt,
  Bytes,
  Address,
  store,
  json,
  JSONValueKind,
} from "@graphprotocol/graph-ts";
import {
  Transfer as TransferEvent,
  Approval as ApprovalEvent,
  ApprovalForAll as ApprovalForAllEvent,
  ERC721,
} from "../generated/ERC721Contract/ERC721";
import { ERC721Metadata } from "../generated/ERC721Contract/ERC721Metadata";
import {
  Token,
  User,
  Transfer,
  Contract,
  Approval,
  ApprovalForAll,
  TokenMetadata,
  TokenAttribute,
} from "../generated/schema";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function handleTransfer(event: TransferEvent): void {
  let contract = getOrCreateContract(event.address);
  let token = getOrCreateToken(event.params.tokenId, event.address);
  let fromUser = getOrCreateUser(event.params.from);
  let toUser = getOrCreateUser(event.params.to);

  // Handle minting (from zero address)
  if (event.params.from.toHexString() == ZERO_ADDRESS) {
    contract.totalSupply = contract.totalSupply.plus(BigInt.fromI32(1));
    contract.save();

    token.createdAtTimestamp = event.block.timestamp;
    token.createdAtBlockNumber = event.block.number;

    toUser.totalTokensReceived = toUser.totalTokensReceived.plus(
      BigInt.fromI32(1)
    );
  }
  // Handle burning (to zero address)
  else if (event.params.to.toHexString() == ZERO_ADDRESS) {
    contract.totalSupply = contract.totalSupply.minus(BigInt.fromI32(1));
    contract.save();

    fromUser.totalTokensSent = fromUser.totalTokensSent.plus(BigInt.fromI32(1));
    fromUser.totalTokensOwned = fromUser.totalTokensOwned.minus(
      BigInt.fromI32(1)
    );
  }
  // Handle regular transfer
  else {
    fromUser.totalTokensSent = fromUser.totalTokensSent.plus(BigInt.fromI32(1));
    fromUser.totalTokensOwned = fromUser.totalTokensOwned.minus(
      BigInt.fromI32(1)
    );

    toUser.totalTokensReceived = toUser.totalTokensReceived.plus(
      BigInt.fromI32(1)
    );
    toUser.totalTokensOwned = toUser.totalTokensOwned.plus(BigInt.fromI32(1));
  }

  // Update token ownership
  token.owner = toUser.id;
  token.approved = null;
  token.updatedAtTimestamp = event.block.timestamp;
  token.updatedAtBlockNumber = event.block.number;

  // Try to fetch metadata
  let metadataURI = fetchTokenURI(event.address, event.params.tokenId);
  if (metadataURI) {
    token.tokenURI = metadataURI;
    let metadata = parseMetadata(metadataURI, token.id);
    if (metadata) {
      token.metadata = metadata.id;
      metadata.save();
    }
  }

  // Create transfer record
  let transfer = new Transfer(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  transfer.token = token.id;
  transfer.from = fromUser.id;
  transfer.to = toUser.id;
  transfer.timestamp = event.block.timestamp;
  transfer.blockNumber = event.block.number;
  transfer.transactionHash = event.transaction.hash;
  transfer.gasPrice = event.transaction.gasPrice;
  transfer.gasUsed = event.receipt ? event.receipt!.gasUsed : BigInt.fromI32(0);

  // Save entities
  fromUser.save();
  toUser.save();
  token.save();
  transfer.save();
}

export function handleApproval(event: ApprovalEvent): void {
  let token = getOrCreateToken(event.params.tokenId, event.address);
  let owner = getOrCreateUser(event.params.owner);
  let approved = getOrCreateUser(event.params.approved);

  // Update token approval
  if (event.params.approved.toHexString() == ZERO_ADDRESS) {
    token.approved = null;
  } else {
    token.approved = approved.id;
  }
  token.updatedAtTimestamp = event.block.timestamp;
  token.updatedAtBlockNumber = event.block.number;

  // Create approval record
  let approval = new Approval(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  approval.token = token.id;
  approval.owner = owner.id;
  approval.approved = approved.id;
  approval.timestamp = event.block.timestamp;
  approval.blockNumber = event.block.number;
  approval.transactionHash = event.transaction.hash;

  token.save();
  approval.save();
}

export function handleApprovalForAll(event: ApprovalForAllEvent): void {
  let contract = getOrCreateContract(event.address);
  let owner = getOrCreateUser(event.params.owner);
  let operator = getOrCreateUser(event.params.operator);

  let approvalForAll = new ApprovalForAll(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  approvalForAll.contract = contract.id;
  approvalForAll.owner = owner.id;
  approvalForAll.operator = operator.id;
  approvalForAll.approved = event.params.approved;
  approvalForAll.timestamp = event.block.timestamp;
  approvalForAll.blockNumber = event.block.number;
  approvalForAll.transactionHash = event.transaction.hash;

  approvalForAll.save();
}

function getOrCreateContract(address: Address): Contract {
  let contract = Contract.load(address.toHexString());
  if (!contract) {
    contract = new Contract(address.toHexString());
    contract.totalSupply = BigInt.fromI32(0);
    contract.createdAtTimestamp = BigInt.fromI32(0);
    contract.createdAtBlockNumber = BigInt.fromI32(0);

    // Try to fetch contract metadata
    let erc721Contract = ERC721.bind(address);
    let nameResult = erc721Contract.try_name();
    let symbolResult = erc721Contract.try_symbol();

    if (!nameResult.reverted) {
      contract.name = nameResult.value;
    }
    if (!symbolResult.reverted) {
      contract.symbol = symbolResult.value;
    }

    contract.save();
  }
  return contract;
}

function getOrCreateToken(tokenId: BigInt, contractAddress: Address): Token {
  let id = contractAddress.toHexString() + "-" + tokenId.toString();
  let token = Token.load(id);
  if (!token) {
    token = new Token(id);
    token.contract = contractAddress.toHexString();
    token.tokenID = tokenId;
    token.owner = ZERO_ADDRESS;
    token.createdAtTimestamp = BigInt.fromI32(0);
    token.createdAtBlockNumber = BigInt.fromI32(0);
    token.updatedAtTimestamp = BigInt.fromI32(0);
    token.updatedAtBlockNumber = BigInt.fromI32(0);
  }
  return token;
}

function getOrCreateUser(address: Address): User {
  let user = User.load(address.toHexString());
  if (!user) {
    user = new User(address.toHexString());
    user.address = address as Bytes;
    user.totalTokensOwned = BigInt.fromI32(0);
    user.totalTokensSent = BigInt.fromI32(0);
    user.totalTokensReceived = BigInt.fromI32(0);
    user.firstTransactionTimestamp = BigInt.fromI32(0);
    user.firstTransactionBlockNumber = BigInt.fromI32(0);
  }
  return user;
}

function fetchTokenURI(
  contractAddress: Address,
  tokenId: BigInt
): string | null {
  let contract = ERC721Metadata.bind(contractAddress);
  let tokenURIResult = contract.try_tokenURI(tokenId);

  if (!tokenURIResult.reverted) {
    return tokenURIResult.value;
  }
  return null;
}

function parseMetadata(uri: string, tokenId: string): TokenMetadata | null {
  // This is a simplified version - in practice you might want to fetch from IPFS/HTTP
  // For this example, we'll create a basic metadata entity
  let metadata = new TokenMetadata(tokenId + "-metadata");

  // You would typically fetch and parse JSON metadata here
  // For now, we'll just store the URI reference
  metadata.name = "Token " + tokenId;
  metadata.description = "NFT Token";
  metadata.image = uri;

  return metadata;
}
