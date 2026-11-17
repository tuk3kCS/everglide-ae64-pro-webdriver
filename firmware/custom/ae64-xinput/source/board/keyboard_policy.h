/* Filter the native working keyboard ledger, never HID queues/DMA storage.
 * The caller owns synchronization and the count/dirty-flag commit.
 * SPDX-License-Identifier: MIT
 */
#ifndef AE64_KEYBOARD_POLICY_H
#define AE64_KEYBOARD_POLICY_H
#include <stdint.h>

#define KEYBOARD_POLICY_CAPACITY 128u

/* Native entries are (usage, owner) bytes. The v0.7 append/release gates assign
 * physical sources unique owners 1..64. Other owners, including macro 240,
 * remain native-owned. Preserve every surviving pair and its original order.
 *
 * No memory is accessed for an absent ledger, an invalid count, or an empty
 * mask. Invalid counts are returned unchanged so the caller can diagnose them
 * without converting corruption into an unbound-key release.
 */
static inline uint32_t keyboard_policy_compact(volatile uint8_t *ledger,
                                                uint32_t count,
                                                uint64_t blocked) {
    if(!ledger || count>KEYBOARD_POLICY_CAPACITY || !blocked)return count;
    uint32_t kept=0;
    for(uint32_t index=0;index<count;index++) {
        uint8_t usage=ledger[index*2u],owner=ledger[index*2u+1u];
        if(owner>=1u && owner<=64u &&
           (blocked&(UINT64_C(1)<<(owner-1u))))continue;
        if(kept!=index) {
            ledger[kept*2u]=usage;
            ledger[kept*2u+1u]=owner;
        }
        kept++;
    }
    return kept;
}
#endif
