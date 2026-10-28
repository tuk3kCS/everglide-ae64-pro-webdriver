/* Freestanding compiler support, no startup/heap replacement. SPDX-License-Identifier: MIT */
#include <stddef.h>
void *memcpy(void *dst,const void *src,size_t n) { unsigned char *d=dst;const unsigned char *s=src;while(n--)*d++=*s++;return dst; }
void *memset(void *dst,int value,size_t n) { unsigned char *d=dst;while(n--)*d++=(unsigned char)value;return dst; }
void *memmove(void *dst,const void *src,size_t n) { unsigned char *d=dst;const unsigned char *s=src;if(d<s)while(n--)*d++=*s++;else { d+=n;s+=n;while(n--)*--d=*--s; }return dst; }
