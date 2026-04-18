#!/bin/bash -e
# pi-gen invokes prerun.sh before every sub-step. Its job is to seed
# ${ROOTFS_DIR} from the previous stage's export — pi-gen relies on
# copy_previous() being called explicitly, which is why stock stages
# ship this file.

if [ ! -d "${ROOTFS_DIR}" ]; then
    copy_previous
fi
