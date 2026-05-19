import { ethers } from "ethers";

const selector = ethers.id("PoolAlreadyExists(bytes32)").slice(0, 10);
console.log("PoolAlreadyExists(bytes32):", selector);

const selectorCTF = ethers.id("ConditionAlreadyPrepared()").slice(0, 10); // Check if this matches
console.log("ConditionAlreadyPrepared():", selectorCTF);
