#!/bin/bash

echo "Installing Debian package build dependencies"

apt-get update -qq

apt-get install -y \
  dpkg-dev